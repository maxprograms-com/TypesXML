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

import { Constants } from "../Constants.js";
import { XMLNode } from "../XMLNode.js";
import { XMLUtils } from "../XMLUtils.js";
import { AttDecl } from "./AttDecl.js";

export class AttListDecl implements XMLNode {

    private name: string;
    private attributes: Map<string, AttDecl>;

    static readonly attTypes: string[] = ['CDATA', 'ID', 'IDREF', 'IDREFS', 'ENTITY', 'ENTITIES', 'NMTOKEN', 'NMTOKENS'];

    constructor(name: string, attributesText: string) {
        this.name = name;
        this.attributes = new Map<string, AttDecl>();
        this.parseAttributes(attributesText);
    }

    getName(): string {
        return this.name;
    }

    getAttributes(): Map<string, AttDecl> {
        return this.attributes;
    }

    parseAttributes(text: string) {
        const parts: string[] = this.split(text);
        const state = { index: 0 };
        let scanIndex: number = 0;

        while (state.index < parts.length) {
            const name: string = parts[state.index++];
            if (!name) {
                continue;
            }

            if (!XMLUtils.isValidXMLName(name)) {
                throw new Error('Invalid attribute name in ATTLIST declaration: ' + '\'' + name + '\'');
            }

            const nameMatch = this.locateToken(text, name, scanIndex);
            scanIndex = nameMatch.position + nameMatch.length;

            if (state.index >= parts.length) {
                throw new Error('Missing attribute type for attribute ' + '\'' + name + '\'');
            }

            const attType: string = this.readAttributeType(parts, state);
            if (!this.isValidAttributeType(attType)) {
                throw new Error('Invalid attribute type in ATTLIST declaration: ' + '\'' + attType + '\'');
            }

            const typeMatch = this.locateToken(text, attType, scanIndex);
            scanIndex = typeMatch.position + typeMatch.length;

            let defaultDecl: string = '';
            let defaultValue: string = '';

            if (state.index < parts.length) {
                const nextPart: string = parts[state.index];

                if (nextPart === '#REQUIRED' || nextPart === '#IMPLIED') {
                    const keywordMatch = this.locateToken(text, nextPart, scanIndex);
                    this.ensureSeparated(text, scanIndex, keywordMatch.position, attType, nextPart);
                    scanIndex = keywordMatch.position + keywordMatch.length;
                    defaultDecl = nextPart;
                    state.index++;
                } else if (nextPart === '#FIXED') {
                    const fixedMatch = this.locateToken(text, nextPart, scanIndex);
                    this.ensureSeparated(text, scanIndex, fixedMatch.position, attType, nextPart);
                    scanIndex = fixedMatch.position + fixedMatch.length;
                    defaultDecl = nextPart;
                    state.index++;

                    if (state.index >= parts.length) {
                        throw new Error('Invalid attribute declaration: missing value for #FIXED attribute ' + '\'' + name + '\'');
                    }

                    const valueToken: string = parts[state.index++];
                    const valueMatch = this.locateToken(text, valueToken, scanIndex);
                    this.ensureSeparated(text, scanIndex, valueMatch.position, nextPart, valueToken);
                    defaultValue = this.isQuotedValue(valueToken) ? this.trimQuotes(valueToken) : valueToken;
                    scanIndex = valueMatch.position + valueMatch.length;
                } else if (nextPart && this.isQuotedValue(nextPart)) {
                    const valueMatch = this.locateToken(text, nextPart, scanIndex);
                    this.ensureSeparated(text, scanIndex, valueMatch.position, attType, nextPart);
                    defaultDecl = nextPart;
                    defaultValue = this.trimQuotes(nextPart);
                    scanIndex = valueMatch.position + valueMatch.length;
                    state.index++;
                } else if (nextPart && !XMLUtils.isValidXMLName(nextPart)) {
                    throw new Error('Invalid attribute declaration: unexpected token ' + '\'' + nextPart + '\'' + ' after attribute type ' + '\'' + attType + '\'');
                }
            }

            const att: AttDecl = new AttDecl(name, attType, defaultDecl, defaultValue);
            this.attributes.set(name, att);
        }
    }

    split(text: string): string[] {
        let result: string[] = [];
        let word: string = '';
        let inQuotes: boolean = false;
        let quoteChar: string = '';

        for (let i: number = 0; i < text.length; i++) {
            let c: string = text.charAt(i);

            if ((c === '"' || c === "'") && !inQuotes) {
                if (word.length > 0) {
                    result.push(word);
                    word = '';
                }
                inQuotes = true;
                quoteChar = c;
                word += c;
            } else if (inQuotes && c === quoteChar) {
                inQuotes = false;
                quoteChar = '';
                word += c;
                if (word.length > 0) {
                    result.push(word);
                    word = '';
                }
            } else if ((c === ' ' || c === '\n' || c === '\r' || c === '\t') && !inQuotes) {
                // Whitespace outside quotes - split here
                if (word.length > 0) {
                    result.push(word);
                    word = '';
                }
            } else {
                // Regular character (including parentheses)
                word += c;
            }
        }

        if (word.length > 0) {
            result.push(word);
        }
        return result;
    }

    private readAttributeType(parts: string[], state: { index: number }): string {
        let token: string = parts[state.index++];

        if (token === 'NOTATION') {
            if (state.index >= parts.length) {
                throw new Error('Expected NOTATION enumeration in ATTLIST declaration');
            }
            let enumeration: string = parts[state.index++];
            enumeration = this.readParenthesized(enumeration, parts, state);
            return 'NOTATION ' + enumeration;
        }

        if (token.includes('(')) {
            return this.readParenthesized(token, parts, state);
        }

        return token;
    }

    private readParenthesized(initial: string, parts: string[], state: { index: number }): string {
        let result = initial;
        let balance: number = this.countParenthesis(initial);

        while (balance > 0) {
            if (state.index >= parts.length) {
                throw new Error('Unterminated parenthesized list in ATTLIST declaration');
            }
            const next: string = parts[state.index++];
            result += ' ' + next;
            balance += this.countParenthesis(next);
        }

        return this.normalizeEnumeration(result);
    }

    private countParenthesis(value: string): number {
        let balance: number = 0;
        for (const char of value) {
            if (char === '(') {
                balance++;
            } else if (char === ')') {
                balance--;
            }
        }
        return balance;
    }

    private normalizeEnumeration(value: string): string {
        let normalized = value.replaceAll(/\s+/g, ' ');
        normalized = normalized.replaceAll(' | ', '|').replaceAll(' |', '|').replaceAll('| ', '|');
        normalized = normalized.replaceAll('( ', '(');
        normalized = normalized.replaceAll(' )', ')');
        return normalized.trim();
    }

    private isQuotedValue(value: string): boolean {
        return (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    }

    private trimQuotes(value: string): string {
        return this.isQuotedValue(value) ? value.substring(1, value.length - 1) : value;
    }

    private isValidAttributeType(attType: string): boolean {
        if (AttListDecl.attTypes.includes(attType)) {
            return true;
        }
        if (attType.startsWith('NOTATION ')) {
            const notation: string = attType.substring('NOTATION '.length).trim();
            return notation.startsWith('(') && notation.endsWith(')');
        }
        if (attType.startsWith('(') && attType.endsWith(')')) {
            return true;
        }
        return false;
    }

    private locateToken(text: string, token: string, startIndex: number): { position: number; length: number } {
        const direct: number = text.indexOf(token, startIndex);
        if (direct !== -1) {
            return { position: direct, length: token.length };
        }

        if (token.startsWith('NOTATION ')) {
            const enumeration: string = token.substring('NOTATION '.length);
            let searchIndex: number = startIndex;

            while (searchIndex < text.length) {
                const notationIndex: number = text.indexOf('NOTATION', searchIndex);
                if (notationIndex === -1) {
                    break;
                }

                const beforeNotation: string = notationIndex > 0 ? text.charAt(notationIndex - 1) : '';
                let cursor: number = notationIndex + 'NOTATION'.length;
                const afterNotation: number = cursor;
                while (cursor < text.length && XMLUtils.isXmlSpace(text.charAt(cursor))) {
                    cursor++;
                }

                if ((notationIndex === 0 || XMLUtils.isXmlSpace(beforeNotation)) &&
                    cursor > afterNotation && text.charAt(cursor) === '(') {
                    const enumerationMatch = this.locateEnumeration(text, enumeration, cursor);
                    if (enumerationMatch && enumerationMatch.position === cursor) {
                        return {
                            position: notationIndex,
                            length: enumerationMatch.position + enumerationMatch.length - notationIndex
                        };
                    }
                }

                searchIndex = notationIndex + 'NOTATION'.length;
            }
        }

        if (token.startsWith('(') && token.endsWith(')')) {
            const enumerationMatch = this.locateEnumeration(text, token, startIndex);
            if (enumerationMatch) {
                return enumerationMatch;
            }
        }

        throw new Error('Invalid attribute declaration: unable to locate token ' + '\'' + token + '\'');
    }

    private locateEnumeration(text: string, token: string, startIndex: number): { position: number; length: number } | undefined {
        const normalizedToken: string = this.normalizeEnumeration(token);
        let searchIndex: number = startIndex;

        while (searchIndex < text.length) {
            const openIndex: number = text.indexOf('(', searchIndex);
            if (openIndex === -1) {
                break;
            }

            let depth: number = 0;
            let cursor: number = openIndex;

            while (cursor < text.length) {
                const char: string = text.charAt(cursor);
                if (char === '(') {
                    depth++;
                } else if (char === ')') {
                    depth--;
                    if (depth === 0) {
                        const segment: string = text.substring(openIndex, cursor + 1);
                        if (this.normalizeEnumeration(segment) === normalizedToken) {
                            return { position: openIndex, length: segment.length };
                        }
                        cursor++;
                        break;
                    }
                }
                cursor++;
            }

            if (depth > 0) {
                break;
            }
            searchIndex = cursor;
        }
        return undefined;
    }

    private ensureSeparated(text: string, startIndex: number, tokenPosition: number, previousToken: string, currentToken: string): void {
        if (tokenPosition < startIndex) {
            throw new Error('Invalid attribute declaration: unexpected ordering between ' + '\'' + previousToken + '\'' + ' and ' + '\'' + currentToken + '\'');
        }
        const between: string = text.substring(startIndex, tokenPosition);
        if (!this.containsWhitespace(between)) {
            throw new Error('Invalid attribute declaration: missing whitespace between ' + '\'' + previousToken + '\'' + ' and ' + '\'' + currentToken + '\'');
        }
    }

    private containsWhitespace(segment: string): boolean {
        for (const char of segment) {
            if (XMLUtils.isXmlSpace(char)) {
                return true;
            }
        }
        return false;
    }

    getNodeType(): number {
        return Constants.ATTRIBUTE_LIST_DECL_NODE;
    }

    toString(): string {
        let result: string = '<!ATTLIST ' + this.name + '\n';
        this.attributes.forEach((a: AttDecl) => {
            result += ' ' + a.toString() + '\n';
        });
        return result + '>';
    }

    equals(node: XMLNode): boolean {
        if (node instanceof AttListDecl) {
            let nodeAtts: Map<string, AttDecl> = node.getAttributes();
            if (this.name !== node.getName() || this.attributes.size !== nodeAtts.size) {
                return false;
            }
            for (let [key, value] of this.attributes) {
                let att: AttDecl | undefined = nodeAtts.get(key);
                if (att === undefined) {
                    return false;
                }
                if (!value.equals(att)) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }
}