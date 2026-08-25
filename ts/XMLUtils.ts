/*******************************************************************************
 * Copyright (c) 2023-2026 Maxprograms.
 *
 * This program and the accompanying materials
 * are made available under the terms of the Eclipse   License 1.0
 * which accompanies this distribution, and is available at
 * https://www.eclipse.org/org/documents/epl-v10.html
 *
 * Contributors:
 *     Maxprograms - initial API and implementation
 *******************************************************************************/

export class XMLUtils {

    static readonly SPACES: string = ' \t\r\n';

    static cleanString(text: string): string {
        let result: string = XMLUtils.replaceAll(text, '&', '&amp;');
        result = XMLUtils.replaceAll(result, '<', '&lt;');
        result = XMLUtils.replaceAll(result, '>', '&gt;');
        return result.replace(/\r(?!\n)/g, '&#xD;');
    }

    static unquote(text: string): string {
        return XMLUtils.replaceAll(text, '"', '&quot;');
    }

    static isXmlSpace(char: string): boolean {
        return this.SPACES.includes(char);
    }

    static hasParameterEntity(text: string) {
        let index: number = text.indexOf('%');
        if (index === -1) {
            return false;
        }
        let length: number = text.length;
        for (let i: number = index + 1; i < length; i++) {
            let c: string = text.charAt(i);
            if (this.isXmlSpace(c)) {
                return false;
            }
            if (c === ';') {
                return true;
            }
        }
        return false;
    }

    static normalizeSpaces(text: string): string {
        return String(text).replaceAll(/\s+/g, ' ');
    }

    static replaceAll(text: string, search: string, replacement: string): string {
        return String(text).split(search).join(replacement);
    }

    static escapeRegExpChars(text: string): string {
        let result: string = '';
        let length: number = text.length;
        for (let i: number = 0; i < length; i++) {
            let c: string = text.charAt(i);
            if ('[]{}()^$?*+.'.includes(c)) {
                result += '\\';
            }
            result += c;
        }
        return result;
    }

    static validXml10Chars(text: string): string {
        let result: string = '';
        for (let i: number = 0; i < text.length;) {
            const codePoint: number = text.codePointAt(i)!;
            if (XMLUtils.isValidXml10Char(codePoint)) {
                result += String.fromCodePoint(codePoint);
            }
            i += codePoint > 0xFFFF ? 2 : 1;
        }
        return result;
    }

    static isValidXml10Char(c: number): boolean {
        // From XML 1.0 spec valid chars: 
        // #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]	
        // any Unicode character, excluding the surrogate blocks, FFFE, and FFFF.
        return c === 0x9 || c == 0xA || c === 0xD ||
            (c >= 0x20 && c <= 0xD7FF) ||
            (c >= 0xE000 && c <= 0xFFFD) ||
            (c >= 0x10000 && c <= 0x10FFFF);
    }

    static validXml11Chars(text: string): string {
        let result: string = '';
        for (let i = 0; i < text.length;) {
            const codePoint: number = text.codePointAt(i)!;
            if (XMLUtils.isValidXml11Char(codePoint)) {
                result += String.fromCodePoint(codePoint);
            }
            i += codePoint > 0xFFFF ? 2 : 1;
        }
        return result;
    }

    static isValidXmlChar(version: string, codePoint: number): boolean {
        return version === '1.1'
            ? XMLUtils.isValidXml11Char(codePoint)
            : XMLUtils.isValidXml10Char(codePoint);
    }

    static ensureValidXmlCodePoint(version: string, codePoint: number, context: string): void {
        if (!XMLUtils.isValidXmlChar(version, codePoint)) {
            const hex: string = codePoint.toString(16).toUpperCase().padStart(4, '0');
            throw new Error('Malformed XML document: forbidden character U+' + hex + ' in ' + context);
        }
    }

    static ensureValidXmlCharacters(version: string, text: string, context: string): void {
        for (let i = 0; i < text.length;) {
            const codePoint: number = text.codePointAt(i)!;
            XMLUtils.ensureValidXmlCodePoint(version, codePoint, context);
            i += codePoint > 0xFFFF ? 2 : 1;
        }
    }

    static isValidXml11Char(c: number): boolean {
        // From XML 1.1 spec valid chars: 
        // [#x1-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]	
        // any Unicode character, excluding the surrogate blocks, FFFE, and FFFF. 
        return (c >= 0x1 && c <= 0xD7FF) ||
            (c >= 0xE000 && c <= 0xFFFD) ||
            (c >= 0x10000 && c <= 0x10FFFF);
    }

    static lookingAt(search: string, text: string, start: number): boolean {
        let length: number = search.length;
        if (length + start > text.length) {
            return false;
        }
        for (let i = 0; i < length; i++) {
            if (text[start + i] !== search[i]) {
                return false;
            }
        }
        return true;
    }

    static isValidXMLName(name: string): boolean {
        if (name.length === 0) {
            return false;
        }

        // XML 1.0 spec: Names must start with a letter, underscore, or colon
        const firstChar = name.charAt(0);
        if (!XMLUtils.isNameStartChar(firstChar)) {
            return false;
        }

        // Check remaining characters
        for (let i = 1; i < name.length; i++) {
            const char = name.charAt(i);
            if (!XMLUtils.isNameChar(char)) {
                return false;
            }
        }

        return true;
    }

    static isNameStartChar(char: string): boolean {
        // XML 1.0 spec: NameStartChar
        const code = char.codePointAt(0);
        if (code === undefined) {
            return false;
        }

        return (
            char === ':' ||
            char === '_' ||
            (code >= 0x41 && code <= 0x5A) ||     // [A-Z]
            (code >= 0x61 && code <= 0x7A) ||     // [a-z]
            (code >= 0xC0 && code <= 0xD6) ||     // [#xC0-#xD6]
            (code >= 0xD8 && code <= 0xF6) ||     // [#xD8-#xF6] (excludes #xD7)
            (code >= 0xF8 && code <= 0x2FF) ||    // [#xF8-#x2FF]
            (code >= 0x370 && code <= 0x37D) ||   // [#x370-#x37D]
            (code >= 0x37F && code <= 0x1FFF) ||  // [#x37F-#x1FFF]
            (code >= 0x200C && code <= 0x200D) || // [#x200C-#x200D]
            (code >= 0x2070 && code <= 0x218F) || // [#x2070-#x218F]
            (code >= 0x2C00 && code <= 0x2FEF) || // [#x2C00-#x2FEF]
            (code >= 0x3001 && code <= 0xD7FF) || // [#x3001-#xD7FF]
            (code >= 0xF900 && code <= 0xFDCF) || // [#xF900-#xFDCF]
            (code >= 0xFDF0 && code <= 0xFFFD) || // [#xFDF0-#xFFFD]
            (code >= 0x10000 && code <= 0xEFFFF)  // [#x10000-#xEFFFF]
        );
    }

    static isNameChar(char: string): boolean {
        // XML 1.0 spec: NameChar includes NameStartChar plus additional characters
        const code = char.codePointAt(0);
        if (code === undefined) {
            return false;
        }

        // First check if it's a valid NameStartChar
        if (XMLUtils.isNameStartChar(char)) {
            return true;
        }

        // Additional characters allowed in names (but not at the start)
        return (
            char === '-' ||
            char === '.' ||
            (code >= 0x30 && code <= 0x39) ||     // [0-9]
            code === 0xB7 ||                      // #xB7
            (code >= 0x0300 && code <= 0x036F) || // [#x0300-#x036F]
            (code >= 0x203F && code <= 0x2040)    // [#x203F-#x2040]
        );
    }

    static isValidNCName(name: string): boolean {
        if (name.length === 0) {
            return false;
        }

        // NCName cannot contain colons (Non-Colonized Name)
        if (name.includes(':')) {
            return false;
        }

        // NCName must start with a letter or underscore (no colon allowed)
        const firstChar = name.charAt(0);
        if (!XMLUtils.isNCNameStartChar(firstChar)) {
            return false;
        }

        // Check remaining characters
        for (let i = 1; i < name.length; i++) {
            const char = name.charAt(i);
            if (!XMLUtils.isNameChar(char)) {
                return false;
            }
        }

        return true;
    }

    static isNCNameStartChar(char: string): boolean {
        // Same as NameStartChar but without colon
        const code = char.codePointAt(0);
        if (code === undefined) {
            return false;
        }

        return (
            char === '_' ||
            (code >= 0x41 && code <= 0x5A) ||     // [A-Z]
            (code >= 0x61 && code <= 0x7A) ||     // [a-z]
            (code >= 0xC0 && code <= 0xD6) ||     // [#xC0-#xD6]
            (code >= 0xD8 && code <= 0xF6) ||     // [#xD8-#xF6] (excludes #xD7)
            (code >= 0xF8 && code <= 0x2FF) ||    // [#xF8-#x2FF]
            (code >= 0x370 && code <= 0x37D) ||   // [#x370-#x37D]
            (code >= 0x37F && code <= 0x1FFF) ||  // [#x37F-#x1FFF]
            (code >= 0x200C && code <= 0x200D) || // [#x200C-#x200D]
            (code >= 0x2070 && code <= 0x218F) || // [#x2070-#x218F]
            (code >= 0x2C00 && code <= 0x2FEF) || // [#x2C00-#x2FEF]
            (code >= 0x3001 && code <= 0xD7FF) || // [#x3001-#xD7FF]
            (code >= 0xF900 && code <= 0xFDCF) || // [#xF900-#xFDCF]
            (code >= 0xFDF0 && code <= 0xFFFD) || // [#xFDF0-#xFFFD]
            (code >= 0x10000 && code <= 0xEFFFF)  // [#x10000-#xEFFFF]
        );
    }

    static isValidNMTOKEN(token: string): boolean {
        if (token.length === 0) {
            return false;
        }

        // NMTOKEN can contain name characters but doesn't need to start with letter
        for (let i = 0; i < token.length; i++) {
            const char = token.charAt(i);
            if (!XMLUtils.isNameChar(char)) {
                return false;
            }
        }

        return true;
    }
}