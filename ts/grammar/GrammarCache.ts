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

import { DTDGrammar } from '../dtd/DTDGrammar.js';
import { SchemaGrammar } from '../schema/SchemaGrammar.js';
import { Grammar } from './Grammar.js';
import { RelaxNGGrammar } from './RelaxNGGrammar.js';

export class GrammarCache {

    private readonly grammars: Map<string, Grammar> = new Map<string, Grammar>();

    has(url: string): boolean {
        return this.grammars.has(url);
    }

    get(url: string): Grammar | undefined {
        const cached: Grammar | undefined = this.grammars.get(url);
        if (cached === undefined) {
            return undefined;
        }
        // Return a copy so document-specific merges never mutate the cached grammar
        if (cached instanceof DTDGrammar) {
            const copy: DTDGrammar = new DTDGrammar();
            copy.merge(cached);
            return copy;
        }
        if (cached instanceof SchemaGrammar) {
            const copy: SchemaGrammar = new SchemaGrammar();
            copy.mergeFrom(cached);
            return copy;
        }
        if (cached instanceof RelaxNGGrammar) {
            return cached.copy();
        }
        return cached;
    }

    put(url: string, grammar: Grammar): void {
        this.grammars.set(url, grammar);
    }

    clear(): void {
        this.grammars.clear();
    }
}
