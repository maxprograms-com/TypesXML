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

import { ValidationContext } from './ValidationContext.js';

export class NamespaceValidationContext implements ValidationContext {

    constructor(
        private readonly bindings: Map<string, string>,
        private readonly defaultNamespace: string,
        private readonly baseUri: string | null = null,
        private readonly entityCheck: (name: string) => boolean = () => false,
        private readonly notationCheck: (name: string) => boolean = () => false
    ) { }

    resolveNamespacePrefix(prefix: string): string | null {
        if (prefix === '') {
            return this.defaultNamespace;
        }
        if (prefix === 'xml') {
            return 'http://www.w3.org/XML/1998/namespace';
        }
        return this.bindings.get(prefix) ?? null;
    }

    getBaseUri(): string | null {
        return this.baseUri;
    }

    isUnparsedEntity(entityName: string): boolean {
        return this.entityCheck(entityName);
    }

    isNotation(notationName: string): boolean {
        return this.notationCheck(notationName);
    }
}
