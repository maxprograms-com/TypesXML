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

import { BuiltinDatatypeLibrary, BUILTIN_LIBRARY_URI } from './BuiltinDatatypeLibrary.js';
import { COMPATIBILITY_DATATYPE_LIBRARY, CompatibilityDatatypeLibrary } from './CompatibilityDatatypeLibrary.js';
import { DatatypeLibrary } from './DatatypeLibrary.js';
import { DatatypeLibraryFactory } from './DatatypeLibraryFactory.js';
import { XSD_DATATYPE_LIBRARY, XsdDatatypeLibrary } from './XsdDatatypeLibrary.js';

export class DatatypeLibraryRegistry implements DatatypeLibraryFactory {

    private static shared: DatatypeLibraryRegistry | undefined;

    private readonly libraries: Map<string, DatatypeLibrary> = new Map<string, DatatypeLibrary>();
    private readonly factories: DatatypeLibraryFactory[] = [];

    constructor() {
        this.libraries.set(BUILTIN_LIBRARY_URI, new BuiltinDatatypeLibrary());
        this.libraries.set(XSD_DATATYPE_LIBRARY, new XsdDatatypeLibrary());
        this.libraries.set(COMPATIBILITY_DATATYPE_LIBRARY, new CompatibilityDatatypeLibrary());
    }

    static getInstance(): DatatypeLibraryRegistry {
        if (!DatatypeLibraryRegistry.shared) {
            DatatypeLibraryRegistry.shared = new DatatypeLibraryRegistry();
        }
        return DatatypeLibraryRegistry.shared;
    }

    registerLibrary(namespaceURI: string, library: DatatypeLibrary): void {
        this.libraries.set(namespaceURI, library);
    }

    registerFactory(factory: DatatypeLibraryFactory): void {
        this.factories.push(factory);
    }

    createDatatypeLibrary(namespaceURI: string): DatatypeLibrary | null {
        const library: DatatypeLibrary | undefined = this.libraries.get(namespaceURI);
        if (library) {
            return library;
        }
        for (const factory of this.factories) {
            const created: DatatypeLibrary | null = factory.createDatatypeLibrary(namespaceURI);
            if (created) {
                return created;
            }
        }
        return null;
    }
}
