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

import { NameClass } from './NameClass.js';
import { AttributePattern, ChoicePattern, DataPattern, ElementPattern, EmptyPattern, GroupPattern, InterleavePattern, ListPattern, NotAllowedPattern, OneOrMorePattern, Pattern, RefPattern, TextPattern, ValuePattern } from './Pattern.js';

const EMPTY: number = 0;
const COMPLEX: number = 1;
const SIMPLE: number = 2;

const IN_LIST: number = 1;
const IN_ATTRIBUTE: number = 2;
const IN_ONE_OR_MORE: number = 4;
const IN_GROUP_UNDER_ONE_OR_MORE: number = 8;
const IN_DATA_EXCEPT: number = 16;
const IN_START: number = 32;

type Summary = {
    contentType: number | undefined;
    attributes: NameClass[];
    elements: NameClass[];
    text: boolean;
};

export class RelaxNGRestrictions {

    private readonly pending: ElementPattern[] = [];
    private readonly reached: ElementPattern[] = [];
    private readonly queued: Set<number> = new Set<number>();
    private readonly memo: Map<string, Summary> = new Map<string, Summary>();
    private readonly expanding: Set<number> = new Set<number>();

    check(start: Pattern): ElementPattern[] {
        this.visit(start, IN_START);
        while (this.pending.length > 0) {
            const element: ElementPattern = this.pending.pop() as ElementPattern;
            const content: Summary = this.visit(element.content, 0);
            if (content.contentType === undefined) {
                throw new Error('The content of element ' + element.nameClass.describe() + ' mixes strings and elements in a way RelaxNG does not allow');
            }
        }
        return this.reached;
    }

    private prohibit(_flags: number, what: string, inside: string): never {
        throw new Error('RelaxNG restriction violated: ' + what + ' is not allowed inside ' + inside);
    }

    private target(pattern: Pattern): Pattern {
        let current: Pattern = pattern;
        while (current instanceof RefPattern) {
            current = current.target;
        }
        return current;
    }

    private leaf(element: ElementPattern, flags: number): Summary {
        if ((flags & IN_ATTRIBUTE) !== 0) {
            this.prohibit(flags, 'an element', 'an attribute');
        }
        if ((flags & IN_LIST) !== 0) {
            this.prohibit(flags, 'an element', 'a list');
        }
        if ((flags & IN_DATA_EXCEPT) !== 0) {
            this.prohibit(flags, 'an element', 'the except clause of a data pattern');
        }
        if (!this.queued.has(element.id)) {
            this.queued.add(element.id);
            this.pending.push(element);
            this.reached.push(element);
        }
        return { contentType: COMPLEX, attributes: [], elements: [element.nameClass], text: false };
    }

    private visit(pattern: Pattern, flags: number): Summary {
        if (pattern instanceof RefPattern) {
            const resolved: Pattern = this.target(pattern);
            if (resolved instanceof ElementPattern) {
                return this.leaf(resolved, flags);
            }
            if (this.expanding.has(pattern.id)) {
                throw new Error('The definition of "' + pattern.name + '" refers to itself without going through an element');
            }
            this.expanding.add(pattern.id);
            try {
                return this.visit(resolved, flags);
            } finally {
                this.expanding.delete(pattern.id);
            }
        }
        const key: string = pattern.id + ':' + flags;
        const cached: Summary | undefined = this.memo.get(key);
        if (cached) {
            return cached;
        }
        const summary: Summary = this.compute(pattern, flags);
        this.memo.set(key, summary);
        return summary;
    }

    private maximum(first: number | undefined, second: number | undefined): number | undefined {
        if (first === undefined || second === undefined) {
            return undefined;
        }
        return Math.max(first, second);
    }

    private groupable(first: number | undefined, second: number | undefined): boolean {
        if (first === undefined || second === undefined) {
            return false;
        }
        return first === EMPTY || second === EMPTY || (first === COMPLEX && second === COMPLEX);
    }

    private compute(pattern: Pattern, flags: number): Summary {
        if (pattern instanceof ElementPattern) {
            return this.leaf(pattern, flags);
        }
        if (pattern instanceof EmptyPattern) {
            if ((flags & IN_START) !== 0 || (flags & IN_DATA_EXCEPT) !== 0) {
                this.prohibit(flags, 'an empty pattern', (flags & IN_START) !== 0 ? 'the start element' : 'the except clause of a data pattern');
            }
            return { contentType: EMPTY, attributes: [], elements: [], text: false };
        }
        if (pattern instanceof NotAllowedPattern) {
            return { contentType: EMPTY, attributes: [], elements: [], text: false };
        }
        if (pattern instanceof TextPattern) {
            if ((flags & (IN_LIST | IN_START | IN_DATA_EXCEPT)) !== 0) {
                this.prohibit(flags, 'text', (flags & IN_LIST) !== 0 ? 'a list' : (flags & IN_START) !== 0 ? 'the start element' : 'the except clause of a data pattern');
            }
            return { contentType: COMPLEX, attributes: [], elements: [], text: true };
        }
        if (pattern instanceof ValuePattern) {
            if ((flags & IN_START) !== 0) {
                this.prohibit(flags, 'a value pattern', 'the start element');
            }
            return { contentType: SIMPLE, attributes: [], elements: [], text: false };
        }
        if (pattern instanceof DataPattern) {
            if ((flags & IN_START) !== 0) {
                this.prohibit(flags, 'a data pattern', 'the start element');
            }
            if (pattern.except) {
                this.visit(pattern.except, flags | IN_DATA_EXCEPT);
            }
            return { contentType: SIMPLE, attributes: [], elements: [], text: false };
        }
        if (pattern instanceof ListPattern) {
            if ((flags & IN_LIST) !== 0) {
                this.prohibit(flags, 'a list', 'a list');
            }
            if ((flags & IN_START) !== 0) {
                this.prohibit(flags, 'a list', 'the start element');
            }
            if ((flags & IN_DATA_EXCEPT) !== 0) {
                this.prohibit(flags, 'a list', 'the except clause of a data pattern');
            }
            this.visit(pattern.pattern, flags | IN_LIST);
            return { contentType: SIMPLE, attributes: [], elements: [], text: false };
        }
        if (pattern instanceof AttributePattern) {
            if ((flags & IN_ATTRIBUTE) !== 0) {
                this.prohibit(flags, 'an attribute', 'an attribute');
            }
            if ((flags & IN_LIST) !== 0) {
                this.prohibit(flags, 'an attribute', 'a list');
            }
            if ((flags & IN_START) !== 0) {
                this.prohibit(flags, 'an attribute', 'the start element');
            }
            if ((flags & IN_DATA_EXCEPT) !== 0) {
                this.prohibit(flags, 'an attribute', 'the except clause of a data pattern');
            }
            if ((flags & IN_GROUP_UNDER_ONE_OR_MORE) !== 0) {
                this.prohibit(flags, 'an attribute', 'a group or interleave that is repeated by oneOrMore');
            }
            const kinds: Set<string> = new Set<string>();
            pattern.nameClass.collectKinds(kinds);
            if ((kinds.has('anyName') || kinds.has('nsName')) && (flags & IN_ONE_OR_MORE) === 0) {
                throw new Error('An attribute that uses anyName or nsName must be repeated with oneOrMore');
            }
            const content: Summary = this.visit(pattern.pattern, flags | IN_ATTRIBUTE);
            if (content.contentType === undefined) {
                throw new Error('The value of attribute ' + pattern.nameClass.describe() + ' mixes strings and elements in a way RelaxNG does not allow');
            }
            return { contentType: EMPTY, attributes: [pattern.nameClass], elements: [], text: false };
        }
        if (pattern instanceof OneOrMorePattern) {
            if ((flags & IN_START) !== 0) {
                this.prohibit(flags, 'oneOrMore', 'the start element');
            }
            if ((flags & IN_DATA_EXCEPT) !== 0) {
                this.prohibit(flags, 'oneOrMore', 'the except clause of a data pattern');
            }
            const content: Summary = this.visit(pattern.pattern, flags | IN_ONE_OR_MORE);
            return {
                contentType: this.groupable(content.contentType, content.contentType) ? content.contentType : undefined,
                attributes: content.attributes, elements: content.elements, text: content.text
            };
        }
        if (pattern instanceof ChoicePattern) {
            const first: Summary = this.visit(pattern.first, flags);
            const second: Summary = this.visit(pattern.second, flags);
            return {
                contentType: this.maximum(first.contentType, second.contentType),
                attributes: first.attributes.concat(second.attributes),
                elements: first.elements.concat(second.elements),
                text: first.text || second.text
            };
        }
        if (pattern instanceof GroupPattern || pattern instanceof InterleavePattern) {
            const isInterleave: boolean = pattern instanceof InterleavePattern;
            if ((flags & IN_START) !== 0) {
                this.prohibit(flags, isInterleave ? 'interleave' : 'a group', 'the start element');
            }
            if ((flags & IN_DATA_EXCEPT) !== 0) {
                this.prohibit(flags, isInterleave ? 'interleave' : 'a group', 'the except clause of a data pattern');
            }
            if (isInterleave && (flags & IN_LIST) !== 0) {
                this.prohibit(flags, 'interleave', 'a list');
            }
            const inner: number = (flags & IN_ONE_OR_MORE) !== 0 ? flags | IN_GROUP_UNDER_ONE_OR_MORE : flags;
            const first: Summary = this.visit(pattern.first, inner);
            const second: Summary = this.visit(pattern.second, inner);
            this.checkDuplicateAttributes(first.attributes, second.attributes);
            if (isInterleave) {
                this.checkInterleave(first, second);
            }
            return {
                contentType: this.groupable(first.contentType, second.contentType) ? this.maximum(first.contentType, second.contentType) : undefined,
                attributes: first.attributes.concat(second.attributes),
                elements: first.elements.concat(second.elements),
                text: first.text || second.text
            };
        }
        throw new Error('Unexpected pattern in schema restrictions check');
    }

    private checkDuplicateAttributes(first: NameClass[], second: NameClass[]): void {
        for (const a of first) {
            for (const b of second) {
                if (NameClass.overlap(a, b)) {
                    throw new Error('The same attribute can be matched twice: ' + a.describe() + ' overlaps ' + b.describe());
                }
            }
        }
    }

    private checkInterleave(first: Summary, second: Summary): void {
        for (const a of first.elements) {
            for (const b of second.elements) {
                if (NameClass.overlap(a, b)) {
                    throw new Error('Both sides of an interleave can match the same element: ' + a.describe() + ' overlaps ' + b.describe());
                }
            }
        }
        if (first.text && second.text) {
            throw new Error('Both sides of an interleave contain text');
        }
    }
}
