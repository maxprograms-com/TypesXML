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
import { ValidationContext } from './ValidationContext.js';

export interface DatatypeBuilder {
    addParameter(name: string, strValue: string, context: ValidationContext | null): void;
    createDatatype(): Datatype;
}
