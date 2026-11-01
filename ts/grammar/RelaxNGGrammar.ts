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

import { AttributeDefault } from '../XMLSchemaParser.js';
import { AttributeInfo, Grammar, GrammarType, ValidationResult } from './Grammar.js';

export class RelaxNGGrammar implements Grammar {

    private readonly defaultAttributes: Map<string, Map<string, AttributeDefault>>;

    constructor(defaultAttributes?: Map<string, Map<string, AttributeDefault>>) {
        this.defaultAttributes = defaultAttributes ?? new Map<string, Map<string, AttributeDefault>>();
    }

    getDefaultAttributesMap(): Map<string, Map<string, AttributeDefault>> {
        return this.defaultAttributes;
    }

    copy(): RelaxNGGrammar {
        const result: Map<string, Map<string, AttributeDefault>> = new Map<string, Map<string, AttributeDefault>>();
        this.defaultAttributes.forEach((attributeMap: Map<string, AttributeDefault>, elementKey: string) => {
            const copied: Map<string, AttributeDefault> = new Map<string, AttributeDefault>();
            attributeMap.forEach((info: AttributeDefault, attributeKey: string) => {
                copied.set(attributeKey, {
                    localName: info.localName,
                    namespace: info.namespace,
                    lexicalName: info.lexicalName,
                    value: info.value
                });
            });
            result.set(elementKey, copied);
        });
        return new RelaxNGGrammar(result);
    }

    validateElement(_element: string, _namespace: string, _children: string[], _text: string): ValidationResult {
        return ValidationResult.success();
    }

    validateAttributes(_element: string, _attributes: Map<string, string>): ValidationResult {
        return ValidationResult.success();
    }

    getElementAttributes(_element: string): Map<string, AttributeInfo> {
        return new Map<string, AttributeInfo>();
    }

    getDefaultAttributes(element: string): Map<string, string> {
        const result: Map<string, string> = new Map<string, string>();
        const attributeMap: Map<string, AttributeDefault> | undefined = this.defaultAttributes.get(element);
        if (attributeMap) {
            attributeMap.forEach((info: AttributeDefault, key: string) => {
                result.set(key, info.value);
            });
        }
        return result;
    }

    resolveEntity(_name: string): string | undefined {
        return undefined;
    }

    getElementTextDefault(_element: string): string | undefined {
        return undefined;
    }

    getGrammarType(): GrammarType {
        return GrammarType.RELAX_NG;
    }

    getTargetNamespaces(): Set<string> {
        return new Set<string>();
    }

    getNamespaceDeclarations(): Map<string, string> {
        return new Map<string, string>();
    }
}
