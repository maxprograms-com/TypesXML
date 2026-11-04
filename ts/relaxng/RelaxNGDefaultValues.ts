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

import { NamespaceValidationContext } from './datatype/NamespaceValidationContext.js';
import { NameClass, NameNameClass } from './NameClass.js';
import { AttributePattern, ChoicePattern, DataPattern, ElementPattern, GroupPattern, InterleavePattern, ListPattern, OneOrMorePattern, Pattern, PatternPool, RefPattern, ValuePattern } from './Pattern.js';

type DefaultedAttribute = {
    attribute: AttributePattern;
    hasChoice: boolean;
    allChoicesOptional: boolean;
};

export class RelaxNGDefaultValues {

    constructor(private readonly pool: PatternPool) { }

    check(elements: ElementPattern[]): void {
        const defaulted: Map<ElementPattern, AttributePattern[]> = new Map<ElementPattern, AttributePattern[]>();
        for (const element of elements) {
            const found: DefaultedAttribute[] = [];
            this.collect(element.content, false, true, found, new Set<string>());
            for (const item of found) {
                this.checkAttribute(element, item);
            }
            defaulted.set(element, found.map((item: DefaultedAttribute) => item.attribute));
        }
        for (const element of elements) {
            const attributes: AttributePattern[] = defaulted.get(element) ?? [];
            if (attributes.length === 0) {
                continue;
            }
            for (const other of elements) {
                if (other === element || !NameClass.overlap(element.nameClass, other.nameClass)) {
                    continue;
                }
                for (const attribute of attributes) {
                    if (!this.hasSameDefault(defaulted.get(other) ?? [], attribute)) {
                        throw new Error('RelaxNG compatibility annotations: attribute ' + attribute.nameClass.describe() + ' of element '
                            + element.nameClass.describe() + ' has a default value, but the competing element ' + other.nameClass.describe()
                            + ' does not declare an attribute with the same name and the same default value');
                    }
                }
            }
        }
    }

    private hasSameDefault(candidates: AttributePattern[], attribute: AttributePattern): boolean {
        const name: NameNameClass = attribute.nameClass as NameNameClass;
        return candidates.some((candidate: AttributePattern) => candidate.nameClass instanceof NameNameClass
            && candidate.nameClass.namespace === name.namespace
            && candidate.nameClass.localName === name.localName
            && candidate.defaultValue === attribute.defaultValue);
    }

    private target(pattern: Pattern): Pattern {
        let current: Pattern = pattern;
        while (current instanceof RefPattern) {
            current = current.target;
        }
        return current;
    }

    private collect(pattern: Pattern, hasChoice: boolean, allChoicesOptional: boolean, found: DefaultedAttribute[], seen: Set<string>): void {
        const p: Pattern = this.target(pattern);
        const key: string = p.id + ':' + (hasChoice ? '1' : '0') + ':' + (allChoicesOptional ? '1' : '0');
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        if (p instanceof AttributePattern) {
            if (p.defaultValue !== undefined) {
                found.push({ attribute: p, hasChoice: hasChoice, allChoicesOptional: allChoicesOptional });
            }
        } else if (p instanceof ChoicePattern) {
            const optional: boolean = p.first === this.pool.empty || p.second === this.pool.empty;
            this.collect(p.first, true, allChoicesOptional && optional, found, seen);
            this.collect(p.second, true, allChoicesOptional && optional, found, seen);
        } else if (p instanceof GroupPattern || p instanceof InterleavePattern) {
            this.collect(p.first, hasChoice, allChoicesOptional, found, seen);
            this.collect(p.second, hasChoice, allChoicesOptional, found, seen);
        } else if (p instanceof OneOrMorePattern) {
            this.collect(p.pattern, hasChoice, allChoicesOptional, found, seen);
        }
    }

    private checkAttribute(element: ElementPattern, item: DefaultedAttribute): void {
        const attribute: AttributePattern = item.attribute;
        const name: string = attribute.nameClass.describe();
        const prefix: string = 'RelaxNG compatibility annotations: attribute ' + name + ' of element ' + element.nameClass.describe() + ' ';
        if (!(attribute.nameClass instanceof NameNameClass) || !(element.nameClass instanceof NameNameClass)) {
            throw new Error(prefix + 'has a default value, so both the attribute and its element must have a single name');
        }
        if (this.containsContextDependent(attribute.pattern, new Set<number>())) {
            throw new Error(prefix + 'has a default value, so its pattern cannot use a context-dependent datatype');
        }
        if (!this.pool.valueMatches(attribute.pattern, attribute.defaultValue as string, new NamespaceValidationContext(new Map<string, string>(), ''))) {
            throw new Error(prefix + 'has the default value "' + attribute.defaultValue + '", which does not match its pattern');
        }
        if (!item.hasChoice || !item.allChoicesOptional) {
            throw new Error(prefix + 'has a default value, so it must be optional: it needs a choice ancestor and every choice ancestor needs an empty alternative');
        }
    }

    private containsContextDependent(pattern: Pattern, seen: Set<number>): boolean {
        const p: Pattern = this.target(pattern);
        if (seen.has(p.id)) {
            return false;
        }
        seen.add(p.id);
        if (p instanceof DataPattern) {
            return p.datatype.isContextDependent() || (p.except !== undefined && this.containsContextDependent(p.except, seen));
        }
        if (p instanceof ValuePattern) {
            return p.datatype.isContextDependent();
        }
        if (p instanceof ChoicePattern || p instanceof GroupPattern || p instanceof InterleavePattern) {
            return this.containsContextDependent(p.first, seen) || this.containsContextDependent(p.second, seen);
        }
        if (p instanceof OneOrMorePattern || p instanceof ListPattern) {
            return this.containsContextDependent(p.pattern, seen);
        }
        return false;
    }
}
