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

export class DatatypeException extends Error {

    static readonly UNKNOWN: number = -1;

    private readonly index: number;

    constructor(message?: string, index: number = DatatypeException.UNKNOWN) {
        super(message);
        this.name = 'DatatypeException';
        this.index = index;
    }

    getIndex(): number {
        return this.index;
    }
}
