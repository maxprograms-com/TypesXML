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

import { Datatype, IdType } from './Datatype.js';
import { DatatypeBuilder } from './DatatypeBuilder.js';
import { DatatypeException } from './DatatypeException.js';
import { DatatypeLibrary } from './DatatypeLibrary.js';
import { DatatypeStreamingValidator } from './DatatypeStreamingValidator.js';
import { ParameterlessDatatypeBuilder } from './ParameterlessDatatypeBuilder.js';
import { StreamingValidatorImpl } from './StreamingValidatorImpl.js';
import { ValidationContext } from './ValidationContext.js';

export const BUILTIN_LIBRARY_URI: string = '';

export class BuiltinDatatype implements Datatype {

    constructor(private readonly typeName: string) { }

    isValid(_literal: string, _context: ValidationContext | null): boolean {
        return true;
    }

    checkValid(_literal: string, _context: ValidationContext | null): void {
        return;
    }

    createStreamingValidator(context: ValidationContext | null): DatatypeStreamingValidator {
        return new StreamingValidatorImpl(this, context);
    }

    createValue(literal: string, _context: ValidationContext | null): unknown | null {
        if (this.typeName === 'token') {
            return literal.replaceAll(/[\t\n\r ]+/g, ' ').trim();
        }
        return literal;
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
        return IdType.NULL;
    }

    isContextDependent(): boolean {
        return false;
    }
}

export class BuiltinDatatypeLibrary implements DatatypeLibrary {

    createDatatypeBuilder(baseTypeLocalName: string): DatatypeBuilder {
        return new ParameterlessDatatypeBuilder(this.createDatatype(baseTypeLocalName));
    }

    createDatatype(typeLocalName: string): Datatype {
        if (typeLocalName !== 'string' && typeLocalName !== 'token') {
            throw new DatatypeException('Unknown built-in RelaxNG datatype "' + typeLocalName + '"');
        }
        return new BuiltinDatatype(typeLocalName);
    }
}
