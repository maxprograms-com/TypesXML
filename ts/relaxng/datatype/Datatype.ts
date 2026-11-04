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

import { DatatypeStreamingValidator } from './DatatypeStreamingValidator.js';
import { ValidationContext } from './ValidationContext.js';

export enum IdType {
    NULL = 0,
    ID = 1,
    IDREF = 2,
    IDREFS = 3
}

export interface Datatype {
    isValid(literal: string, context: ValidationContext | null): boolean;
    checkValid(literal: string, context: ValidationContext | null): void;
    createStreamingValidator(context: ValidationContext | null): DatatypeStreamingValidator;
    createValue(literal: string, context: ValidationContext | null): unknown | null;
    sameValue(value1: unknown, value2: unknown): boolean;
    valueHashCode(value: unknown): number;
    getIdType(): IdType;
    isContextDependent(): boolean;
}
