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

import { AttributeInfo, AttributeUse } from '../grammar/Grammar.js';
import { NameNameClass } from './NameClass.js';
import { RelaxNGSchema } from './PatternBuilder.js';
import { AttributePattern, ChoicePattern, DataPattern, ElementPattern, GroupPattern, InterleavePattern, ListPattern, OneOrMorePattern, Pattern, RefPattern, ValuePattern } from './Pattern.js';

type FoundAttribute = {
    attribute: AttributePattern;
    required: boolean;
};

export class RelaxNGSchemaInfo {

    constructor(private readonly schema: RelaxNGSchema) { }

    getNamespaces(): Set<string> {
        const names: NameNameClass[] = [];
        const namespaces: Set<string> = new Set<string>();
        for (const element of this.schema.elements) {
            element.nameClass.collect(names, namespaces);
            for (const found of this.attributesOf(element)) {
                found.attribute.nameClass.collect(names, namespaces);
            }
        }
        namespaces.delete('');
        return namespaces;
    }

    getAttributes(element: string): Map<string, AttributeInfo> {
        const index: number = element.indexOf(':');
        const localName: string = index === -1 ? element : element.substring(index + 1);
        let merged: Map<string, AttributeInfo> | undefined;
        for (const candidate of this.schema.elements) {
            if (!(candidate.nameClass instanceof NameNameClass) || candidate.nameClass.localName !== localName) {
                continue;
            }
            const current: Map<string, AttributeInfo> = this.describeAttributes(candidate);
            if (merged === undefined) {
                merged = current;
                continue;
            }
            current.forEach((info: AttributeInfo, name: string) => {
                const existing: AttributeInfo | undefined = merged!.get(name);
                if (existing === undefined) {
                    info.use = AttributeUse.OPTIONAL;
                    merged!.set(name, info);
                } else if (info.use !== AttributeUse.REQUIRED) {
                    existing.use = AttributeUse.OPTIONAL;
                }
            });
            merged.forEach((info: AttributeInfo, name: string) => {
                if (!current.has(name)) {
                    info.use = AttributeUse.OPTIONAL;
                }
            });
        }
        return merged ?? new Map<string, AttributeInfo>();
    }

    private describeAttributes(element: ElementPattern): Map<string, AttributeInfo> {
        const result: Map<string, AttributeInfo> = new Map<string, AttributeInfo>();
        for (const found of this.attributesOf(element)) {
            const nameClass = found.attribute.nameClass;
            if (!(nameClass instanceof NameNameClass)) {
                continue;
            }
            const existing: AttributeInfo | undefined = result.get(nameClass.localName);
            const use: AttributeUse = found.required ? AttributeUse.REQUIRED : AttributeUse.OPTIONAL;
            if (existing !== undefined) {
                existing.use = AttributeUse.OPTIONAL;
                continue;
            }
            result.set(nameClass.localName, new AttributeInfo(
                nameClass.localName,
                this.datatypeOf(found.attribute.pattern),
                use,
                found.attribute.defaultValue,
                undefined,
                nameClass.namespace === '' ? null : nameClass.namespace));
        }
        return result;
    }

    private target(pattern: Pattern): Pattern {
        let current: Pattern = pattern;
        while (current instanceof RefPattern) {
            current = current.target;
        }
        return current;
    }

    private attributesOf(element: ElementPattern): FoundAttribute[] {
        const found: FoundAttribute[] = [];
        this.collect(element.content, true, found, new Set<string>());
        return found;
    }

    private collect(pattern: Pattern, required: boolean, found: FoundAttribute[], seen: Set<string>): void {
        const p: Pattern = this.target(pattern);
        const key: string = p.id + ':' + (required ? '1' : '0');
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        if (p instanceof AttributePattern) {
            found.push({ attribute: p, required: required });
        } else if (p instanceof ChoicePattern) {
            this.collect(p.first, false, found, seen);
            this.collect(p.second, false, found, seen);
        } else if (p instanceof GroupPattern || p instanceof InterleavePattern) {
            this.collect(p.first, required, found, seen);
            this.collect(p.second, required, found, seen);
        } else if (p instanceof OneOrMorePattern) {
            this.collect(p.pattern, required, found, seen);
        }
    }

    private datatypeOf(pattern: Pattern): string {
        const p: Pattern = this.target(pattern);
        if (p instanceof DataPattern || p instanceof ValuePattern) {
            return p.typeName !== '' ? p.typeName : 'string';
        }
        if (p instanceof ChoicePattern) {
            const first: string = this.datatypeOf(p.first);
            return first !== 'text' ? first : this.datatypeOf(p.second);
        }
        if (p instanceof ListPattern) {
            return 'list';
        }
        return 'text';
    }
}
