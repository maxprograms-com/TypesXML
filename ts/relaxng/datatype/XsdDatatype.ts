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

import { SchemaFacets, SchemaTypeValidator } from '../../schema/SchemaTypeValidator.js';
import { XsdRegexTranslator } from '../../schema/XsdRegexTranslator.js';
import { Datatype, IdType } from './Datatype.js';
import { DatatypeException } from './DatatypeException.js';
import { DatatypeStreamingValidator } from './DatatypeStreamingValidator.js';
import { StreamingValidatorImpl } from './StreamingValidatorImpl.js';
import { ValidationContext } from './ValidationContext.js';

const INTEGER_TYPES: Set<string> = new Set<string>([
    'integer', 'long', 'int', 'short', 'byte', 'unsignedLong', 'unsignedInt', 'unsignedShort',
    'unsignedByte', 'nonNegativeInteger', 'positiveInteger', 'nonPositiveInteger', 'negativeInteger'
]);

const NCNAME_PATTERN: string = '[\\i-[:]][\\c-[:]]*';
const NAME_PATTERNS: Map<string, RegExp> = new Map<string, RegExp>([
    ['Name', XsdRegexTranslator.toRegExp('\\i\\c*')],
    ['NCName', XsdRegexTranslator.toRegExp(NCNAME_PATTERN)],
    ['ID', XsdRegexTranslator.toRegExp(NCNAME_PATTERN)],
    ['IDREF', XsdRegexTranslator.toRegExp(NCNAME_PATTERN)],
    ['ENTITY', XsdRegexTranslator.toRegExp(NCNAME_PATTERN)],
    ['IDREFS', XsdRegexTranslator.toRegExp(NCNAME_PATTERN)],
    ['ENTITIES', XsdRegexTranslator.toRegExp(NCNAME_PATTERN)],
    ['NMTOKEN', XsdRegexTranslator.toRegExp('\\c+')],
    ['NMTOKENS', XsdRegexTranslator.toRegExp('\\c+')],
    ['QName', XsdRegexTranslator.toRegExp('(' + NCNAME_PATTERN + ':)?' + NCNAME_PATTERN)],
    ['NOTATION', XsdRegexTranslator.toRegExp('(' + NCNAME_PATTERN + ':)?' + NCNAME_PATTERN)]
]);

class QNameValue {
    constructor(readonly namespace: string, readonly localName: string) { }
}

export class XsdDatatype implements Datatype {

    constructor(private readonly typeName: string, private readonly facets: SchemaFacets) { }

    private normalize(literal: string): string {
        switch (this.facets.whiteSpace) {
            case 'replace':
                return literal.replaceAll(/[\t\n\r]/g, ' ');
            case 'collapse':
                return literal.replaceAll(/[\t\n\r ]+/g, ' ').trim();
            default:
                return literal;
        }
    }

    private checkLexical(normalized: string, context: ValidationContext | null): string | undefined {
        const namePattern: RegExp | undefined = NAME_PATTERNS.get(this.typeName);
        if (namePattern === undefined) {
            return SchemaTypeValidator.validate(normalized, this.typeName) ? undefined : 'not a valid ' + this.typeName;
        }
        if (this.facets.isList) {
            const tokens: string[] = normalized.length === 0 ? [] : normalized.split(' ');
            if (tokens.length === 0 || !tokens.every((token: string) => namePattern.test(token))) {
                return 'not a valid ' + this.typeName;
            }
        } else if (!namePattern.test(normalized)) {
            return 'not a valid ' + this.typeName;
        }
        if (this.typeName === 'QName' || this.typeName === 'NOTATION') {
            const index: number = normalized.indexOf(':');
            if (index !== -1) {
                const prefix: string = normalized.substring(0, index);
                if (context === null || context.resolveNamespacePrefix(prefix) === null) {
                    return 'undeclared namespace prefix "' + prefix + '"';
                }
            }
        }
        if (this.typeName === 'ENTITY' || this.typeName === 'ENTITIES') {
            for (const token of normalized.split(' ')) {
                if (context === null || !context.isUnparsedEntity(token)) {
                    return 'no unparsed entity named "' + token + '" is declared';
                }
            }
        }
        return undefined;
    }

    private problem(literal: string, context: ValidationContext | null): string | undefined {
        const normalized: string = this.normalize(literal);
        const lexical: string | undefined = this.checkLexical(normalized, context);
        if (lexical !== undefined) {
            return lexical;
        }
        if (!SchemaTypeValidator.validateFacets(normalized, this.facets, this.typeName)) {
            return 'violates the constraining facets of ' + this.typeName;
        }
        return undefined;
    }

    isValid(literal: string, context: ValidationContext | null): boolean {
        return this.problem(literal, context) === undefined;
    }

    checkValid(literal: string, context: ValidationContext | null): void {
        const problem: string | undefined = this.problem(literal, context);
        if (problem !== undefined) {
            throw new DatatypeException('"' + literal + '" is ' + problem);
        }
    }

    createStreamingValidator(context: ValidationContext | null): DatatypeStreamingValidator {
        return new StreamingValidatorImpl(this, context);
    }

    createValue(literal: string, context: ValidationContext | null): unknown | null {
        if (this.problem(literal, context) !== undefined) {
            return null;
        }
        const normalized: string = this.normalize(literal);
        if (this.typeName === 'QName' || this.typeName === 'NOTATION') {
            const index: number = normalized.indexOf(':');
            const prefix: string = index === -1 ? '' : normalized.substring(0, index);
            const namespace: string = context?.resolveNamespacePrefix(prefix) ?? '';
            return new QNameValue(namespace, index === -1 ? normalized : normalized.substring(index + 1));
        }
        if (this.facets.isList) {
            return normalized.length === 0 ? [] : normalized.split(' ');
        }
        if (INTEGER_TYPES.has(this.typeName)) {
            return BigInt(normalized.startsWith('+') ? normalized.substring(1) : normalized);
        }
        if (this.typeName === 'decimal') {
            return this.canonicalDecimal(normalized);
        }
        if (this.typeName === 'float' || this.typeName === 'double') {
            if (normalized === 'INF') {
                return Number.POSITIVE_INFINITY;
            }
            if (normalized === '-INF') {
                return Number.NEGATIVE_INFINITY;
            }
            return Number(normalized);
        }
        if (this.typeName === 'boolean') {
            return normalized === 'true' || normalized === '1';
        }
        return normalized;
    }

    private canonicalDecimal(normalized: string): string {
        let sign: string = '';
        let digits: string = normalized;
        if (digits.startsWith('+') || digits.startsWith('-')) {
            sign = digits.startsWith('-') ? '-' : '';
            digits = digits.substring(1);
        }
        const dot: number = digits.indexOf('.');
        let whole: string = dot === -1 ? digits : digits.substring(0, dot);
        let fraction: string = dot === -1 ? '' : digits.substring(dot + 1);
        whole = whole.replace(/^0+(?=\d)/, '');
        fraction = fraction.replace(/0+$/, '');
        if (whole === '') {
            whole = '0';
        }
        const isZero: boolean = whole === '0' && fraction === '';
        return (isZero ? '' : sign) + whole + (fraction === '' ? '' : '.' + fraction);
    }

    sameValue(value1: unknown, value2: unknown): boolean {
        if (value1 instanceof QNameValue && value2 instanceof QNameValue) {
            return value1.namespace === value2.namespace && value1.localName === value2.localName;
        }
        if (Array.isArray(value1) && Array.isArray(value2)) {
            return value1.length === value2.length && value1.every((item: unknown, i: number) => item === value2[i]);
        }
        if (typeof value1 === 'number' && typeof value2 === 'number' && Number.isNaN(value1) && Number.isNaN(value2)) {
            return true;
        }
        return value1 === value2;
    }

    valueHashCode(value: unknown): number {
        let text: string;
        if (value instanceof QNameValue) {
            text = '{' + value.namespace + '}' + value.localName;
        } else if (Array.isArray(value)) {
            text = value.join(' ');
        } else {
            text = String(value);
        }
        let hash: number = 0;
        for (let i: number = 0; i < text.length; i++) {
            hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
        }
        return hash;
    }

    getIdType(): IdType {
        switch (this.typeName) {
            case 'ID':
                return IdType.ID;
            case 'IDREF':
                return IdType.IDREF;
            case 'IDREFS':
                return IdType.IDREFS;
            default:
                return IdType.NULL;
        }
    }

    isContextDependent(): boolean {
        return this.typeName === 'QName' || this.typeName === 'NOTATION' || this.typeName === 'ENTITY' || this.typeName === 'ENTITIES';
    }
}
