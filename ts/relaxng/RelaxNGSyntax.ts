/*******************************************************************************
 * Copyright (c) 2023-2026 Maxprograms.
 *
 * This program and the accompanying materials
 * are made available under the terms of the Eclipse Public License 1.0
 * which accompanies this distribution, and is available at
 * https://www.eclipse.org/org/documents/epl-v10.html
 *
 * Contributors:
 *     Maxprograms - initial API and implementation
 *******************************************************************************/

import { CData } from '../CData.js';
import { Constants } from '../Constants.js';
import { RelaxNGParser } from '../RelaxNGParser.js';
import { TextNode } from '../TextNode.js';
import { XMLAttribute } from '../XMLAttribute.js';
import { XMLElement } from '../XMLElement.js';
import { XMLNode } from '../XMLNode.js';
import { NamespaceValidationContext } from './datatype/NamespaceValidationContext.js';
import { RelaxNGSchema } from './PatternBuilder.js';
import { RELAXNG_SYNTAX_SCHEMA } from './RelaxNGSyntaxSchema.js';
import { RelaxNGAttribute, RelaxNGValidator } from './RelaxNGValidator.js';

export class RelaxNGSyntax {

    private static schema: RelaxNGSchema | undefined;

    static validate(root: XMLElement): void {
        if (!RelaxNGSyntax.schema) {
            RelaxNGSyntax.schema = new RelaxNGParser('relaxng.rng', undefined, { skipSyntaxCheck: true, content: RELAXNG_SYNTAX_SCHEMA }).getSchema();
        }
        const validator: RelaxNGValidator = new RelaxNGValidator(RelaxNGSyntax.schema);
        RelaxNGSyntax.walk(root, new Map<string, string>(), validator);
        validator.endDocument();
    }

    private static resolve(qName: string, bindings: Map<string, string>, isElement: boolean): { namespace: string; localName: string } {
        const index: number = qName.indexOf(':');
        if (index === -1) {
            return { namespace: isElement ? (bindings.get('') ?? '') : '', localName: qName };
        }
        const prefix: string = qName.substring(0, index);
        const uri: string | undefined = prefix === 'xml' ? 'http://www.w3.org/XML/1998/namespace' : bindings.get(prefix);
        if (uri === undefined) {
            throw new Error('RelaxNG validation error: undeclared namespace prefix "' + prefix + '" in "' + qName + '"');
        }
        return { namespace: uri, localName: qName.substring(index + 1) };
    }

    private static walk(element: XMLElement, parentBindings: Map<string, string>, validator: RelaxNGValidator): void {
        const bindings: Map<string, string> = new Map<string, string>(parentBindings);
        for (const attribute of element.getAttributes()) {
            const name: string = attribute.getName();
            if (name === 'xmlns') {
                bindings.set('', attribute.getValue());
            } else if (name.startsWith('xmlns:')) {
                bindings.set(name.substring(6), attribute.getValue());
            }
        }
        const resolved: { namespace: string; localName: string } = RelaxNGSyntax.resolve(element.getName(), bindings, true);
        const attributes: RelaxNGAttribute[] = [];
        element.getAttributes().forEach((attribute: XMLAttribute) => {
            const name: string = attribute.getName();
            if (name === 'xmlns' || name.startsWith('xmlns:')) {
                return;
            }
            const attributeName: { namespace: string; localName: string } = RelaxNGSyntax.resolve(name, bindings, false);
            attributes.push({ namespace: attributeName.namespace, localName: attributeName.localName, qName: name, value: attribute.getValue() });
        });
        validator.startElement(resolved.namespace, resolved.localName, element.getName(), attributes, new NamespaceValidationContext(bindings, bindings.get('') ?? ''));
        element.getContent().forEach((node: XMLNode) => {
            const type: number = node.getNodeType();
            if (type === Constants.ELEMENT_NODE) {
                RelaxNGSyntax.walk(node as XMLElement, bindings, validator);
            } else if (type === Constants.TEXT_NODE) {
                validator.characters((node as TextNode).getValue());
            } else if (type === Constants.CDATA_SECTION_NODE) {
                validator.characters((node as CData).getValue());
            }
        });
        validator.endElement();
    }
}
