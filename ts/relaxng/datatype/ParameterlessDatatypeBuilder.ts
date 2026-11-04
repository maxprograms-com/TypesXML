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

import { Datatype } from './Datatype.js';
import { DatatypeBuilder } from './DatatypeBuilder.js';
import { DatatypeException } from './DatatypeException.js';
import { ValidationContext } from './ValidationContext.js';

export class ParameterlessDatatypeBuilder implements DatatypeBuilder {

    constructor(private readonly baseType: Datatype) { }

    addParameter(_name: string, _strValue: string, _context: ValidationContext | null): void {
        throw new DatatypeException();
    }

    createDatatype(): Datatype {
        return this.baseType;
    }
}
