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
import { DatatypeStreamingValidator } from './DatatypeStreamingValidator.js';
import { ValidationContext } from './ValidationContext.js';

export class StreamingValidatorImpl implements DatatypeStreamingValidator {

    private buffer: string = '';

    constructor(private readonly baseType: Datatype, private readonly context: ValidationContext | null) { }

    addCharacters(text: string): void {
        this.buffer += text;
    }

    isValid(): boolean {
        return this.baseType.isValid(this.buffer, this.context);
    }

    checkValid(): void {
        this.baseType.checkValid(this.buffer, this.context);
    }
}
