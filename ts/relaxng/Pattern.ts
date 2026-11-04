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

import { Datatype, IdType } from './datatype/Datatype.js';
import { ValidationContext } from './datatype/ValidationContext.js';
import { NameClass } from './NameClass.js';

let nextPatternId: number = 0;

export abstract class Pattern {
    readonly id: number = nextPatternId++;
    private nullableCache: boolean | undefined;

    protected abstract computeNullable(): boolean;

    get nullable(): boolean {
        if (this.nullableCache === undefined) {
            this.nullableCache = this.computeNullable();
        }
        return this.nullableCache;
    }
}

export class EmptyPattern extends Pattern {
    protected computeNullable(): boolean { return true; }
}

export class TextPattern extends Pattern {
    protected computeNullable(): boolean { return true; }
}

export class NotAllowedPattern extends Pattern {
    protected computeNullable(): boolean { return false; }
}

export class ChoicePattern extends Pattern {
    constructor(readonly first: Pattern, readonly second: Pattern) { super(); }
    protected computeNullable(): boolean { return this.first.nullable || this.second.nullable; }
}

export class GroupPattern extends Pattern {
    constructor(readonly first: Pattern, readonly second: Pattern) { super(); }
    protected computeNullable(): boolean { return this.first.nullable && this.second.nullable; }
}

export class InterleavePattern extends Pattern {
    constructor(readonly first: Pattern, readonly second: Pattern) { super(); }
    protected computeNullable(): boolean { return this.first.nullable && this.second.nullable; }
}

export class OneOrMorePattern extends Pattern {
    constructor(readonly pattern: Pattern) { super(); }
    protected computeNullable(): boolean { return this.pattern.nullable; }
}

export class AfterPattern extends Pattern {
    constructor(readonly first: Pattern, readonly second: Pattern) { super(); }
    protected computeNullable(): boolean { return false; }
}

export class AttributePattern extends Pattern {
    constructor(readonly nameClass: NameClass, readonly pattern: Pattern, readonly idType: IdType = IdType.NULL, readonly defaultValue?: string) { super(); }
    protected computeNullable(): boolean { return false; }
}

export class ElementPattern extends Pattern {
    constructor(readonly nameClass: NameClass, readonly content: Pattern) { super(); }
    protected computeNullable(): boolean { return false; }
}

export class ListPattern extends Pattern {
    constructor(readonly pattern: Pattern) { super(); }
    protected computeNullable(): boolean { return false; }
}

export class DataPattern extends Pattern {
    constructor(readonly datatype: Datatype, readonly except?: Pattern, readonly typeName: string = '') { super(); }
    protected computeNullable(): boolean { return false; }
}

export class ValuePattern extends Pattern {
    constructor(readonly datatype: Datatype, readonly value: unknown, readonly typeName: string = '') { super(); }
    protected computeNullable(): boolean { return false; }
}

export class RefPattern extends Pattern {
    private resolved: Pattern | undefined;

    constructor(readonly name: string) { super(); }

    setTarget(target: Pattern): void {
        this.resolved = target;
    }

    get target(): Pattern {
        if (this.resolved === undefined) {
            throw new Error('RelaxNG reference to undefined pattern "' + this.name + '"');
        }
        return this.resolved;
    }

    protected computeNullable(): boolean { return this.target.nullable; }
}

export class PatternPool {

    readonly empty: Pattern = new EmptyPattern();
    readonly text: Pattern = new TextPattern();
    readonly notAllowed: Pattern = new NotAllowedPattern();
    hasIds: boolean = false;

    private readonly interned: Map<string, Pattern> = new Map<string, Pattern>();
    private readonly closeCache: Map<number, Pattern> = new Map<number, Pattern>();
    private readonly endCache: Map<number, Pattern> = new Map<number, Pattern>();
    private readonly openCache: Map<string, Pattern> = new Map<string, Pattern>();

    private intern(key: string, create: () => Pattern): Pattern {
        let found: Pattern | undefined = this.interned.get(key);
        if (found === undefined) {
            found = create();
            this.interned.set(key, found);
        }
        return found;
    }

    choice(first: Pattern, second: Pattern): Pattern {
        if (first === this.notAllowed) {
            return second;
        }
        if (second === this.notAllowed || first === second) {
            return first;
        }
        if (first.id > second.id) {
            const swap: Pattern = first;
            first = second;
            second = swap;
        }
        return this.intern('c' + first.id + ',' + second.id, () => new ChoicePattern(first, second));
    }

    group(first: Pattern, second: Pattern): Pattern {
        if (first === this.notAllowed || second === this.notAllowed) {
            return this.notAllowed;
        }
        if (first === this.empty) {
            return second;
        }
        if (second === this.empty) {
            return first;
        }
        return this.intern('g' + first.id + ',' + second.id, () => new GroupPattern(first, second));
    }

    interleave(first: Pattern, second: Pattern): Pattern {
        if (first === this.notAllowed || second === this.notAllowed) {
            return this.notAllowed;
        }
        if (first === this.empty) {
            return second;
        }
        if (second === this.empty) {
            return first;
        }
        if (first.id > second.id) {
            const swap: Pattern = first;
            first = second;
            second = swap;
        }
        return this.intern('i' + first.id + ',' + second.id, () => new InterleavePattern(first, second));
    }

    oneOrMore(pattern: Pattern): Pattern {
        if (pattern === this.notAllowed || pattern === this.empty) {
            return pattern;
        }
        return this.intern('o' + pattern.id, () => new OneOrMorePattern(pattern));
    }

    optional(pattern: Pattern): Pattern {
        return this.choice(pattern, this.empty);
    }

    zeroOrMore(pattern: Pattern): Pattern {
        return this.choice(this.oneOrMore(pattern), this.empty);
    }

    after(first: Pattern, second: Pattern): Pattern {
        if (first === this.notAllowed || second === this.notAllowed) {
            return this.notAllowed;
        }
        return this.intern('a' + first.id + ',' + second.id, () => new AfterPattern(first, second));
    }

    attribute(nameClass: NameClass, pattern: Pattern, defaultValue?: string): Pattern {
        if (pattern === this.notAllowed) {
            return this.notAllowed;
        }
        let idType: IdType = IdType.NULL;
        if (pattern instanceof DataPattern || pattern instanceof ValuePattern) {
            idType = pattern.datatype.getIdType();
        }
        if (idType !== IdType.NULL) {
            this.hasIds = true;
        }
        return new AttributePattern(nameClass, pattern, idType, defaultValue);
    }

    element(nameClass: NameClass, content: Pattern): Pattern {
        return new ElementPattern(nameClass, content);
    }

    list(pattern: Pattern): Pattern {
        if (pattern === this.notAllowed) {
            return this.notAllowed;
        }
        return new ListPattern(pattern);
    }

    data(datatype: Datatype, except?: Pattern, typeName: string = ''): Pattern {
        return new DataPattern(datatype, except === this.notAllowed ? undefined : except, typeName);
    }

    value(datatype: Datatype, value: unknown, typeName: string = ''): Pattern {
        return new ValuePattern(datatype, value, typeName);
    }

    ref(name: string): RefPattern {
        return new RefPattern(name);
    }

    private deref(pattern: Pattern): Pattern {
        let current: Pattern = pattern;
        while (current instanceof RefPattern) {
            current = current.target;
        }
        return current;
    }

    private applyAfter(f: (continuation: Pattern) => Pattern, pattern: Pattern): Pattern {
        if (pattern instanceof AfterPattern) {
            return this.after(pattern.first, f(pattern.second));
        }
        if (pattern instanceof ChoicePattern) {
            return this.choice(this.applyAfter(f, pattern.first), this.applyAfter(f, pattern.second));
        }
        return this.notAllowed;
    }

    textDeriv(pattern: Pattern, text: string, context: ValidationContext): Pattern {
        const p: Pattern = this.deref(pattern);
        if (p instanceof ChoicePattern) {
            return this.choice(this.textDeriv(p.first, text, context), this.textDeriv(p.second, text, context));
        }
        if (p instanceof InterleavePattern) {
            return this.choice(
                this.interleave(this.textDeriv(p.first, text, context), p.second),
                this.interleave(p.first, this.textDeriv(p.second, text, context)));
        }
        if (p instanceof GroupPattern) {
            const advanced: Pattern = this.group(this.textDeriv(p.first, text, context), p.second);
            return p.first.nullable ? this.choice(advanced, this.textDeriv(p.second, text, context)) : advanced;
        }
        if (p instanceof AfterPattern) {
            return this.after(this.textDeriv(p.first, text, context), p.second);
        }
        if (p instanceof OneOrMorePattern) {
            return this.group(this.textDeriv(p.pattern, text, context), this.choice(p, this.empty));
        }
        if (p instanceof TextPattern) {
            return p;
        }
        if (p instanceof ValuePattern) {
            const value: unknown | null = p.datatype.createValue(text, context);
            return value !== null && p.datatype.sameValue(p.value, value) ? this.empty : this.notAllowed;
        }
        if (p instanceof DataPattern) {
            if (!p.datatype.isValid(text, context)) {
                return this.notAllowed;
            }
            if (p.except && this.textDeriv(p.except, text, context).nullable) {
                return this.notAllowed;
            }
            return this.empty;
        }
        if (p instanceof ListPattern) {
            let current: Pattern = p.pattern;
            const trimmed: string = text.trim();
            if (trimmed.length > 0) {
                for (const token of trimmed.split(/[ \t\r\n]+/)) {
                    current = this.textDeriv(current, token, context);
                }
            }
            return current.nullable ? this.empty : this.notAllowed;
        }
        return this.notAllowed;
    }

    startTagOpenDeriv(pattern: Pattern, namespace: string, localName: string): Pattern {
        const p: Pattern = this.deref(pattern);
        const key: string = p.id + '|' + namespace + '|' + localName;
        const cached: Pattern | undefined = this.openCache.get(key);
        if (cached !== undefined) {
            return cached;
        }
        const result: Pattern = this.computeStartTagOpen(p, namespace, localName);
        this.openCache.set(key, result);
        return result;
    }

    private computeStartTagOpen(p: Pattern, namespace: string, localName: string): Pattern {
        if (p instanceof ChoicePattern) {
            return this.choice(
                this.startTagOpenDeriv(p.first, namespace, localName),
                this.startTagOpenDeriv(p.second, namespace, localName));
        }
        if (p instanceof ElementPattern) {
            return p.nameClass.contains(namespace, localName) ? this.after(p.content, this.empty) : this.notAllowed;
        }
        if (p instanceof InterleavePattern) {
            return this.choice(
                this.applyAfter((rest: Pattern) => this.interleave(rest, p.second), this.startTagOpenDeriv(p.first, namespace, localName)),
                this.applyAfter((rest: Pattern) => this.interleave(p.first, rest), this.startTagOpenDeriv(p.second, namespace, localName)));
        }
        if (p instanceof OneOrMorePattern) {
            return this.applyAfter(
                (rest: Pattern) => this.group(rest, this.choice(p, this.empty)),
                this.startTagOpenDeriv(p.pattern, namespace, localName));
        }
        if (p instanceof GroupPattern) {
            const advanced: Pattern = this.applyAfter(
                (rest: Pattern) => this.group(rest, p.second),
                this.startTagOpenDeriv(p.first, namespace, localName));
            return p.first.nullable ? this.choice(advanced, this.startTagOpenDeriv(p.second, namespace, localName)) : advanced;
        }
        if (p instanceof AfterPattern) {
            return this.applyAfter(
                (rest: Pattern) => this.after(rest, p.second),
                this.startTagOpenDeriv(p.first, namespace, localName));
        }
        return this.notAllowed;
    }

    attDeriv(pattern: Pattern, namespace: string, localName: string, value: string, context: ValidationContext): Pattern {
        const p: Pattern = this.deref(pattern);
        if (p instanceof AfterPattern) {
            return this.after(this.attDeriv(p.first, namespace, localName, value, context), p.second);
        }
        if (p instanceof ChoicePattern) {
            return this.choice(
                this.attDeriv(p.first, namespace, localName, value, context),
                this.attDeriv(p.second, namespace, localName, value, context));
        }
        if (p instanceof GroupPattern) {
            return this.choice(
                this.group(this.attDeriv(p.first, namespace, localName, value, context), p.second),
                this.group(p.first, this.attDeriv(p.second, namespace, localName, value, context)));
        }
        if (p instanceof InterleavePattern) {
            return this.choice(
                this.interleave(this.attDeriv(p.first, namespace, localName, value, context), p.second),
                this.interleave(p.first, this.attDeriv(p.second, namespace, localName, value, context)));
        }
        if (p instanceof OneOrMorePattern) {
            return this.group(this.attDeriv(p.pattern, namespace, localName, value, context), this.choice(p, this.empty));
        }
        if (p instanceof AttributePattern) {
            if (p.nameClass.contains(namespace, localName) && this.valueMatches(p.pattern, value, context)) {
                return this.empty;
            }
            return this.notAllowed;
        }
        return this.notAllowed;
    }

    valueMatches(pattern: Pattern, value: string, context: ValidationContext): boolean {
        if (pattern.nullable && /^[ \t\r\n]*$/.test(value)) {
            return true;
        }
        return this.textDeriv(pattern, value, context).nullable;
    }

    startTagCloseDeriv(pattern: Pattern): Pattern {
        const p: Pattern = this.deref(pattern);
        const cached: Pattern | undefined = this.closeCache.get(p.id);
        if (cached !== undefined) {
            return cached;
        }
        let result: Pattern;
        if (p instanceof AfterPattern) {
            result = this.after(this.startTagCloseDeriv(p.first), p.second);
        } else if (p instanceof ChoicePattern) {
            result = this.choice(this.startTagCloseDeriv(p.first), this.startTagCloseDeriv(p.second));
        } else if (p instanceof GroupPattern) {
            result = this.group(this.startTagCloseDeriv(p.first), this.startTagCloseDeriv(p.second));
        } else if (p instanceof InterleavePattern) {
            result = this.interleave(this.startTagCloseDeriv(p.first), this.startTagCloseDeriv(p.second));
        } else if (p instanceof OneOrMorePattern) {
            result = this.oneOrMore(this.startTagCloseDeriv(p.pattern));
        } else if (p instanceof AttributePattern) {
            result = this.notAllowed;
        } else {
            result = p;
        }
        this.closeCache.set(p.id, result);
        return result;
    }

    endTagDeriv(pattern: Pattern): Pattern {
        const p: Pattern = this.deref(pattern);
        const cached: Pattern | undefined = this.endCache.get(p.id);
        if (cached !== undefined) {
            return cached;
        }
        let result: Pattern;
        if (p instanceof ChoicePattern) {
            result = this.choice(this.endTagDeriv(p.first), this.endTagDeriv(p.second));
        } else if (p instanceof AfterPattern) {
            result = p.first.nullable ? p.second : this.notAllowed;
        } else {
            result = this.notAllowed;
        }
        this.endCache.set(p.id, result);
        return result;
    }

    attributeIdType(pattern: Pattern, namespace: string, localName: string, seen: Set<number> = new Set<number>()): IdType {
        const p: Pattern = this.deref(pattern);
        if (seen.has(p.id)) {
            return IdType.NULL;
        }
        seen.add(p.id);
        if (p instanceof AttributePattern) {
            return p.nameClass.contains(namespace, localName) ? p.idType : IdType.NULL;
        }
        if (p instanceof ChoicePattern || p instanceof GroupPattern || p instanceof InterleavePattern) {
            const first: IdType = this.attributeIdType(p.first, namespace, localName, seen);
            return first !== IdType.NULL ? first : this.attributeIdType(p.second, namespace, localName, seen);
        }
        if (p instanceof OneOrMorePattern) {
            return this.attributeIdType(p.pattern, namespace, localName, seen);
        }
        if (p instanceof AfterPattern) {
            return this.attributeIdType(p.first, namespace, localName, seen);
        }
        return IdType.NULL;
    }

    expectedElements(pattern: Pattern, into: Set<NameClass> = new Set<NameClass>(), seen: Set<number> = new Set<number>()): Set<NameClass> {
        const p: Pattern = this.deref(pattern);
        if (seen.has(p.id)) {
            return into;
        }
        seen.add(p.id);
        if (p instanceof ElementPattern) {
            into.add(p.nameClass);
        } else if (p instanceof ChoicePattern || p instanceof InterleavePattern) {
            this.expectedElements(p.first, into, seen);
            this.expectedElements(p.second, into, seen);
        } else if (p instanceof GroupPattern) {
            this.expectedElements(p.first, into, seen);
            if (p.first.nullable) {
                this.expectedElements(p.second, into, seen);
            }
        } else if (p instanceof OneOrMorePattern) {
            this.expectedElements(p.pattern, into, seen);
        } else if (p instanceof AfterPattern) {
            this.expectedElements(p.first, into, seen);
        }
        return into;
    }

    requiredAttributes(pattern: Pattern): Set<AttributePattern> {
        const p: Pattern = this.deref(pattern);
        const result: Set<AttributePattern> = new Set<AttributePattern>();
        if (p instanceof AttributePattern) {
            result.add(p);
        } else if (p instanceof GroupPattern || p instanceof InterleavePattern) {
            this.requiredAttributes(p.first).forEach((a: AttributePattern) => result.add(a));
            this.requiredAttributes(p.second).forEach((a: AttributePattern) => result.add(a));
        } else if (p instanceof ChoicePattern) {
            const second: Set<AttributePattern> = this.requiredAttributes(p.second);
            this.requiredAttributes(p.first).forEach((a: AttributePattern) => {
                if (second.has(a)) {
                    result.add(a);
                }
            });
        } else if (p instanceof OneOrMorePattern) {
            return this.requiredAttributes(p.pattern);
        } else if (p instanceof AfterPattern) {
            return this.requiredAttributes(p.first);
        }
        return result;
    }
}
