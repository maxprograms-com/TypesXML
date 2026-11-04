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
import { NamespaceValidationContext } from '../relaxng/datatype/NamespaceValidationContext.js';
import { RelaxNGSchema } from '../relaxng/PatternBuilder.js';
import { RelaxNGSchemaInfo } from '../relaxng/RelaxNGSchemaInfo.js';
import { RelaxNGAttribute, RelaxNGValidator } from '../relaxng/RelaxNGValidator.js';
import { AttributeInfo, Grammar, GrammarType, ValidationResult } from './Grammar.js';

export class RelaxNGGrammar implements Grammar {

    private readonly defaultAttributes: Map<string, Map<string, AttributeDefault>>;

    private readonly schemaSource: (() => RelaxNGSchema) | undefined;
    private validator: RelaxNGValidator | undefined;
    private schemaInfo: RelaxNGSchemaInfo | undefined;
    private scopes: Array<Map<string, string>> = [];

    constructor(defaultAttributes?: Map<string, Map<string, AttributeDefault>>, schemaSource?: () => RelaxNGSchema) {
        this.defaultAttributes = defaultAttributes ?? new Map<string, Map<string, AttributeDefault>>();
        if (schemaSource) {
            let compiled: RelaxNGSchema | undefined;
            this.schemaSource = (): RelaxNGSchema => {
                if (!compiled) {
                    compiled = schemaSource();
                }
                return compiled;
            };
        }
    }

    characters(text: string): void {
        if (this.validator && this.scopes.length > 0) {
            this.validator.characters(text);
        }
    }

    private resolveName(qName: string, bindings: Map<string, string>, isElement: boolean): { namespace: string; localName: string } {
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
        return new RelaxNGGrammar(result, this.schemaSource);
    }

    validateElement(_element: string, _namespace: string, _children: string[], _text: string): ValidationResult {
        if (!this.validator) {
            return ValidationResult.success();
        }
        try {
            this.validator.endElement();
            this.scopes.pop();
            if (this.scopes.length === 0) {
                const finished: RelaxNGValidator = this.validator;
                this.validator = undefined;
                finished.endDocument();
            }
        } catch (error) {
            return ValidationResult.error(error instanceof Error ? error.message : String(error));
        }
        return ValidationResult.success();
    }

    validateAttributes(element: string, attributes: Map<string, string>): ValidationResult {
        if (!this.schemaSource) {
            return ValidationResult.success();
        }
        if (this.scopes.length === 0) {
            try {
                this.validator = new RelaxNGValidator(this.schemaSource());
            } catch (error) {
                return ValidationResult.error(error instanceof Error ? error.message : String(error));
            }
        }
        const bindings: Map<string, string> = new Map<string, string>(this.scopes[this.scopes.length - 1] ?? []);
        attributes.forEach((value: string, name: string) => {
            if (name === 'xmlns') {
                bindings.set('', value);
            } else if (name.startsWith('xmlns:')) {
                bindings.set(name.substring(6), value);
            }
        });
        this.scopes.push(bindings);
        try {
            const resolvedElement: { namespace: string; localName: string } = this.resolveName(element, bindings, true);
            const list: RelaxNGAttribute[] = [];
            attributes.forEach((value: string, name: string) => {
                if (name === 'xmlns' || name.startsWith('xmlns:')) {
                    return;
                }
                const resolved: { namespace: string; localName: string } = this.resolveName(name, bindings, false);
                list.push({ namespace: resolved.namespace, localName: resolved.localName, qName: name, value: value });
            });
            this.validator!.startElement(resolvedElement.namespace, resolvedElement.localName, element, list, new NamespaceValidationContext(bindings, bindings.get('') ?? ''));
        } catch (error) {
            return ValidationResult.error(error instanceof Error ? error.message : String(error));
        }
        return ValidationResult.success();
    }

    getElementAttributes(element: string): Map<string, AttributeInfo> {
        return this.getSchemaInfo()?.getAttributes(element) ?? new Map<string, AttributeInfo>();
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
        return this.getSchemaInfo()?.getNamespaces() ?? new Set<string>();
    }

    private getSchemaInfo(): RelaxNGSchemaInfo | undefined {
        if (!this.schemaInfo && this.schemaSource) {
            this.schemaInfo = new RelaxNGSchemaInfo(this.schemaSource());
        }
        return this.schemaInfo;
    }

    getNamespaceDeclarations(): Map<string, string> {
        return new Map<string, string>();
    }
}
