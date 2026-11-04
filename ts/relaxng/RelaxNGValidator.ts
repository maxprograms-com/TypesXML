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

import { IdType } from './datatype/Datatype.js';
import { ValidationContext } from './datatype/ValidationContext.js';
import { NameClass } from './NameClass.js';
import { AttributePattern, Pattern, PatternPool } from './Pattern.js';
import { RelaxNGSchema } from './PatternBuilder.js';

export interface RelaxNGAttribute {
    namespace: string;
    localName: string;
    qName: string;
    value: string;
}

class Frame {
    text: string = '';
    hasChildren: boolean = false;

    constructor(readonly qName: string, readonly context: ValidationContext) { }
}

export class RelaxNGValidator {

    private readonly pool: PatternPool;
    private current: Pattern;
    private readonly stack: Frame[] = [];
    private readonly ids: Set<string> = new Set<string>();
    private readonly references: Array<{ value: string; element: string }> = [];

    constructor(schema: RelaxNGSchema) {
        this.pool = schema.pool;
        this.current = schema.start;
    }

    startElement(namespace: string, localName: string, qName: string, attributes: RelaxNGAttribute[], context: ValidationContext): void {
        const parent: Frame | undefined = this.stack[this.stack.length - 1];
        if (parent) {
            this.flushText(parent);
            parent.hasChildren = true;
        }
        const before: Pattern = this.current;
        let next: Pattern = this.pool.startTagOpenDeriv(before, namespace, localName);
        if (next === this.pool.notAllowed) {
            throw new Error(this.where(qName) + 'element "' + qName + '" is not allowed here' + this.expectedText(before));
        }
        for (const attribute of attributes) {
            const afterAttribute: Pattern = this.pool.attDeriv(next, attribute.namespace, attribute.localName, attribute.value, context);
            if (afterAttribute === this.pool.notAllowed) {
                throw new Error(this.where(qName) + 'attribute "' + attribute.qName + '" is not allowed on element "' + qName + '" or its value "' + attribute.value + '" is invalid');
            }
            if (this.pool.hasIds) {
                this.trackIds(this.pool.attributeIdType(next, attribute.namespace, attribute.localName), attribute, qName);
            }
            next = afterAttribute;
        }
        const closed: Pattern = this.pool.startTagCloseDeriv(next);
        if (closed === this.pool.notAllowed) {
            const missing: string[] = [];
            this.pool.requiredAttributes(next).forEach((required: AttributePattern) => missing.push(required.nameClass.describe()));
            throw new Error(this.where(qName) + 'element "' + qName + '" is missing required attribute' + (missing.length === 1 ? ' ' : 's ') + (missing.length > 0 ? missing.join(', ') : '(attributes do not satisfy the schema)'));
        }
        this.current = closed;
        this.stack.push(new Frame(qName, context));
    }

    private trackIds(idType: IdType, attribute: RelaxNGAttribute, qName: string): void {
        if (idType === IdType.NULL) {
            return;
        }
        const tokens: string[] = attribute.value.trim().split(/[ \t\r\n]+/);
        for (const token of tokens) {
            if (idType === IdType.ID) {
                if (this.ids.has(token)) {
                    throw new Error(this.where(qName) + 'duplicate ID "' + token + '" in attribute "' + attribute.qName + '"');
                }
                this.ids.add(token);
            } else {
                this.references.push({ value: token, element: qName });
            }
        }
    }

    endDocument(): void {
        for (const reference of this.references) {
            if (!this.ids.has(reference.value)) {
                throw new Error('RelaxNG validation error: IDREF "' + reference.value + '" on element "' + reference.element + '" does not match any ID');
            }
        }
    }

    characters(text: string): void {
        const frame: Frame | undefined = this.stack[this.stack.length - 1];
        if (frame) {
            frame.text += text;
        }
    }

    endElement(): void {
        const frame: Frame | undefined = this.stack[this.stack.length - 1];
        if (!frame) {
            return;
        }
        if (frame.hasChildren) {
            this.flushText(frame);
        } else {
            const afterText: Pattern = this.pool.textDeriv(this.current, frame.text, frame.context);
            if (/^[ \t\r\n]*$/.test(frame.text)) {
                this.current = this.pool.choice(this.current, afterText);
            } else {
                if (afterText === this.pool.notAllowed) {
                    throw new Error(this.where(frame.qName) + 'text content of element "' + frame.qName + '" is not allowed or invalid: "' + this.abbreviate(frame.text) + '"');
                }
                this.current = afterText;
            }
        }
        const before: Pattern = this.current;
        const ended: Pattern = this.pool.endTagDeriv(before);
        if (ended === this.pool.notAllowed) {
            throw new Error(this.where(frame.qName) + 'element "' + frame.qName + '" has incomplete content' + this.expectedText(before));
        }
        this.current = ended;
        this.stack.pop();
    }

    isComplete(): boolean {
        return this.stack.length === 0 && this.current.nullable;
    }

    private flushText(frame: Frame): void {
        const text: string = frame.text;
        frame.text = '';
        if (text.length === 0 || /^[ \t\r\n]*$/.test(text)) {
            return; // whitespace between elements is not significant
        }
        const next: Pattern = this.pool.textDeriv(this.current, text, frame.context);
        if (next === this.pool.notAllowed) {
            throw new Error(this.where(frame.qName) + 'text is not allowed here in element "' + frame.qName + '": "' + this.abbreviate(text) + '"');
        }
        this.current = next;
    }

    private expectedText(pattern: Pattern): string {
        const names: Set<NameClass> = this.pool.expectedElements(pattern);
        if (names.size === 0) {
            return '';
        }
        const described: string[] = [];
        names.forEach((nameClass: NameClass) => {
            if (described.length < 10) {
                described.push(nameClass.describe());
            }
        });
        return '; expected: ' + described.join(', ') + (names.size > 10 ? ', ...' : '');
    }

    private abbreviate(text: string): string {
        const trimmed: string = text.trim();
        return trimmed.length > 40 ? trimmed.substring(0, 40) + '...' : trimmed;
    }

    private where(qName: string): string {
        const path: string[] = this.stack.map((frame: Frame) => frame.qName);
        if (path[path.length - 1] !== qName) {
            path.push(qName);
        }
        return 'RelaxNG validation error at /' + path.join('/') + ': ';
    }
}
