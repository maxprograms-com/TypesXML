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

export abstract class NameClass {
    abstract contains(namespace: string, localName: string): boolean;
    abstract describe(): string;
    abstract collect(names: NameNameClass[], namespaces: Set<string>): void;
    abstract collectKinds(kinds: Set<string>): void;

    static overlap(first: NameClass, second: NameClass): boolean {
        const names: NameNameClass[] = [];
        const namespaces: Set<string> = new Set<string>(['', 'urn:relaxng:unlisted-namespace']);
        first.collect(names, namespaces);
        second.collect(names, namespaces);
        const listed: Set<string> = new Set<string>(names.map((name: NameNameClass) => name.localName));
        let unlisted: string = 'unlisted-name';
        while (listed.has(unlisted)) {
            unlisted += '-';
        }
        const candidates: NameNameClass[] = [...names];
        namespaces.forEach((namespace: string) => candidates.push(new NameNameClass(namespace, unlisted)));
        return candidates.some((candidate: NameNameClass) => first.contains(candidate.namespace, candidate.localName) && second.contains(candidate.namespace, candidate.localName));
    }
}

export class AnyNameClass extends NameClass {
    constructor(private readonly except?: NameClass) {
        super();
    }

    contains(namespace: string, localName: string): boolean {
        return this.except ? !this.except.contains(namespace, localName) : true;
    }

    describe(): string {
        return this.except ? 'any name except ' + this.except.describe() : 'any name';
    }

    collect(names: NameNameClass[], namespaces: Set<string>): void {
        this.except?.collect(names, namespaces);
    }

    collectKinds(kinds: Set<string>): void {
        kinds.add('anyName');
        this.except?.collectKinds(kinds);
    }
}

export class NsNameClass extends NameClass {
    constructor(private readonly namespace: string, private readonly except?: NameClass) {
        super();
    }

    contains(namespace: string, localName: string): boolean {
        if (namespace !== this.namespace) {
            return false;
        }
        return this.except ? !this.except.contains(namespace, localName) : true;
    }

    describe(): string {
        const base: string = 'any name in namespace "' + this.namespace + '"';
        return this.except ? base + ' except ' + this.except.describe() : base;
    }

    collect(names: NameNameClass[], namespaces: Set<string>): void {
        namespaces.add(this.namespace);
        this.except?.collect(names, namespaces);
    }

    collectKinds(kinds: Set<string>): void {
        kinds.add('nsName');
        this.except?.collectKinds(kinds);
    }
}

export class NameNameClass extends NameClass {
    constructor(readonly namespace: string, readonly localName: string) {
        super();
    }

    contains(namespace: string, localName: string): boolean {
        return this.namespace === namespace && this.localName === localName;
    }

    describe(): string {
        return this.namespace ? '{' + this.namespace + '}' + this.localName : this.localName;
    }

    collect(names: NameNameClass[], namespaces: Set<string>): void {
        names.push(this);
        namespaces.add(this.namespace);
    }

    collectKinds(kinds: Set<string>): void {
        kinds.add('name');
    }
}

export class ChoiceNameClass extends NameClass {
    constructor(private readonly first: NameClass, private readonly second: NameClass) {
        super();
    }

    contains(namespace: string, localName: string): boolean {
        return this.first.contains(namespace, localName) || this.second.contains(namespace, localName);
    }

    describe(): string {
        return this.first.describe() + ' or ' + this.second.describe();
    }

    collect(names: NameNameClass[], namespaces: Set<string>): void {
        this.first.collect(names, namespaces);
        this.second.collect(names, namespaces);
    }

    collectKinds(kinds: Set<string>): void {
        this.first.collectKinds(kinds);
        this.second.collectKinds(kinds);
    }
}
