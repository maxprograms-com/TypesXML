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

import { XMLUtils } from '../../XMLUtils.js';
import { Datatype, IdType } from './Datatype.js';
import { DatatypeBuilder } from './DatatypeBuilder.js';
import { DatatypeException } from './DatatypeException.js';
import { DatatypeLibrary } from './DatatypeLibrary.js';
import { DatatypeStreamingValidator } from './DatatypeStreamingValidator.js';
import { ParameterlessDatatypeBuilder } from './ParameterlessDatatypeBuilder.js';
import { StreamingValidatorImpl } from './StreamingValidatorImpl.js';
import { ValidationContext } from './ValidationContext.js';

export const COMPATIBILITY_DATATYPE_LIBRARY: string = 'http://relaxng.org/ns/compatibility/datatypes/1.0';

class CompatibilityDatatype implements Datatype {

    constructor(private readonly typeName: string, private readonly idType: IdType) { }

    private tokens(literal: string): string[] {
        const trimmed: string = literal.replaceAll(/^[\t\n\r ]+|[\t\n\r ]+$/g, '');
        return trimmed.length === 0 ? [] : trimmed.split(/[\t\n\r ]+/);
    }

    private problem(literal: string): string | undefined {
        const tokens: string[] = this.tokens(literal);
        if (tokens.length === 0) {
            return 'empty';
        }
        if (this.idType !== IdType.IDREFS && tokens.length !== 1) {
            return 'not a single name';
        }
        for (const token of tokens) {
            if (!XMLUtils.isValidNCName(token)) {
                return 'not a valid NCName: "' + token + '"';
            }
        }
        return undefined;
    }

    isValid(literal: string, _context: ValidationContext | null): boolean {
        return this.problem(literal) === undefined;
    }

    checkValid(literal: string, _context: ValidationContext | null): void {
        const problem: string | undefined = this.problem(literal);
        if (problem !== undefined) {
            throw new DatatypeException('"' + literal + '" is not a valid ' + this.typeName + ': ' + problem);
        }
    }

    createStreamingValidator(context: ValidationContext | null): DatatypeStreamingValidator {
        return new StreamingValidatorImpl(this, context);
    }

    createValue(literal: string, _context: ValidationContext | null): unknown | null {
        if (this.problem(literal) !== undefined) {
            return null;
        }
        return this.tokens(literal).join(' ');
    }

    sameValue(value1: unknown, value2: unknown): boolean {
        return value1 === value2;
    }

    valueHashCode(value: unknown): number {
        const text: string = String(value);
        let hash: number = 0;
        for (let i: number = 0; i < text.length; i++) {
            hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
        }
        return hash;
    }

    getIdType(): IdType {
        return this.idType;
    }

    isContextDependent(): boolean {
        return false;
    }
}

export class CompatibilityDatatypeLibrary implements DatatypeLibrary {

    createDatatypeBuilder(baseTypeLocalName: string): DatatypeBuilder {
        return new ParameterlessDatatypeBuilder(this.createDatatype(baseTypeLocalName));
    }

    createDatatype(typeLocalName: string): Datatype {
        switch (typeLocalName) {
            case 'ID':
                return new CompatibilityDatatype(typeLocalName, IdType.ID);
            case 'IDREF':
                return new CompatibilityDatatype(typeLocalName, IdType.IDREF);
            case 'IDREFS':
                return new CompatibilityDatatype(typeLocalName, IdType.IDREFS);
            default:
                throw new DatatypeException('Unknown compatibility datatype "' + typeLocalName + '"');
        }
    }
}
