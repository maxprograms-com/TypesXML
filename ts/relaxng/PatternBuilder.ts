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

import { XMLElement } from '../XMLElement.js';
import { Datatype, IdType } from './datatype/Datatype.js';
import { DatatypeBuilder } from './datatype/DatatypeBuilder.js';
import { DatatypeLibrary } from './datatype/DatatypeLibrary.js';
import { DatatypeLibraryFactory } from './datatype/DatatypeLibraryFactory.js';
import { DatatypeLibraryRegistry } from './datatype/DatatypeLibraryRegistry.js';
import { NamespaceValidationContext } from './datatype/NamespaceValidationContext.js';
import { ValidationContext } from './datatype/ValidationContext.js';
import { AnyNameClass, ChoiceNameClass, NameClass, NameNameClass, NsNameClass } from './NameClass.js';
import { RelaxNGDefaultValues } from './RelaxNGDefaultValues.js';
import { RelaxNGRestrictions } from './RelaxNGRestrictions.js';
import { AttributePattern, AfterPattern, ChoicePattern, ElementPattern, GroupPattern, InterleavePattern, OneOrMorePattern, Pattern, PatternPool, RefPattern } from './Pattern.js';

const COMPATIBILITY_ANNOTATIONS_NS: string = 'http://relaxng.org/ns/compatibility/annotations/1.0';

export class RelaxNGSchema {
    constructor(readonly pool: PatternPool, readonly start: Pattern, readonly elements: ElementPattern[] = []) { }
}

class Scope {
    readonly starts: XMLElement[] = [];
    readonly definitions: Map<string, XMLElement[]> = new Map<string, XMLElement[]>();
    readonly refs: Map<string, RefPattern> = new Map<string, RefPattern>();
    startPattern: Pattern | undefined;

    constructor(readonly parent: Scope | undefined, readonly libraryAtGrammar: string) { }
}

export class PatternBuilder {

    private readonly pool: PatternPool = new PatternPool();
    private readonly contexts: Map<XMLElement, ValidationContext> = new Map<XMLElement, ValidationContext>();
    private readonly idPositions: Set<XMLElement> = new Set<XMLElement>();
    private readonly elementPatterns: ElementPattern[] = [];
    private active: Set<RefPattern> = new Set<RefPattern>();
    private loopDetection: boolean = true;

    constructor(private readonly libraries: DatatypeLibraryFactory = DatatypeLibraryRegistry.getInstance()) { }

    build(root: XMLElement): RelaxNGSchema {
        this.collectContexts(root, new Map<string, string>(), '');
        let start: Pattern;
        if (this.localName(root) === 'grammar') {
            start = this.buildGrammar(root, undefined, '');
        } else {
            start = this.buildPattern(root, new Scope(undefined, ''), '');
        }
        const reachable: ElementPattern[] = new RelaxNGRestrictions().check(start);
        new RelaxNGDefaultValues(this.pool).check(reachable);
        if (this.pool.hasIds) {
            this.checkIdCompatibility();
        }
        return new RelaxNGSchema(this.pool, start, reachable);
    }

    private collectAttributes(pattern: Pattern, into: AttributePattern[], seen: Set<number>): void {
        let p: Pattern = pattern;
        while (p instanceof RefPattern) {
            p = p.target;
        }
        if (seen.has(p.id)) {
            return;
        }
        seen.add(p.id);
        if (p instanceof AttributePattern) {
            into.push(p);
        } else if (p instanceof ChoicePattern || p instanceof GroupPattern || p instanceof InterleavePattern || p instanceof AfterPattern) {
            this.collectAttributes(p.first, into, seen);
            this.collectAttributes(p.second, into, seen);
        } else if (p instanceof OneOrMorePattern) {
            this.collectAttributes(p.pattern, into, seen);
        }
    }

    private checkIdCompatibility(): void {
        const attributesOf: Map<ElementPattern, AttributePattern[]> = new Map<ElementPattern, AttributePattern[]>();
        for (const element of this.elementPatterns) {
            const attributes: AttributePattern[] = [];
            this.collectAttributes(element.content, attributes, new Set<number>());
            attributesOf.set(element, attributes);
        }
        for (const element of this.elementPatterns) {
            for (const attribute of attributesOf.get(element)!) {
                if (attribute.idType === IdType.NULL) {
                    continue;
                }
                if (!(attribute.nameClass instanceof NameNameClass)) {
                    throw new Error('An attribute with an ID, IDREF or IDREFS datatype must have a single name, but it uses ' + attribute.nameClass.describe());
                }
                if (!(element.nameClass instanceof NameNameClass)) {
                    throw new Error('Attribute "' + attribute.nameClass.describe() + '" has an ID, IDREF or IDREFS datatype, so its element must have a single name, but it uses ' + element.nameClass.describe());
                }
                for (const other of this.elementPatterns) {
                    if (other !== element && !NameClass.overlap(element.nameClass, other.nameClass)) {
                        continue;
                    }
                    for (const competitor of attributesOf.get(other)!) {
                        if (competitor !== attribute && competitor.idType !== attribute.idType && NameClass.overlap(attribute.nameClass, competitor.nameClass)) {
                            throw new Error('Attribute "' + attribute.nameClass.describe() + '" of element "' + element.nameClass.describe()
                                + '" has a different ID type than the competing attribute "' + competitor.nameClass.describe() + '" of element "' + other.nameClass.describe() + '"');
                        }
                    }
                }
            }
        }
    }

    private collectContexts(element: XMLElement, inheritedBindings: Map<string, string>, inheritedNs: string): void {
        let bindings: Map<string, string> = inheritedBindings;
        for (const attribute of element.getAttributes()) {
            if (attribute.getName().startsWith('xmlns:')) {
                if (bindings === inheritedBindings) {
                    bindings = new Map<string, string>(inheritedBindings);
                }
                bindings.set(attribute.getName().substring(6), attribute.getValue());
            }
        }
        const ns: string = element.getAttribute('ns')?.getValue() ?? inheritedNs;
        const name: string = this.localName(element);
        if (name === 'value' || name === 'param' || name === 'attribute') {
            this.contexts.set(element, new NamespaceValidationContext(bindings, ns));
        }
        for (const child of element.getChildren()) {
            this.collectContexts(child, bindings, ns);
        }
    }

    private localName(element: XMLElement): string {
        const name: string = element.getName();
        const index: number = name.indexOf(':');
        return index === -1 ? name : name.substring(index + 1);
    }

    private patternChildren(element: XMLElement): XMLElement[] {
        return element.getChildren().filter((child: XMLElement) => this.localName(child) !== 'defaultValue');
    }

    private defaultValueOf(element: XMLElement): string | undefined {
        const context: ValidationContext | undefined = this.contexts.get(element);
        for (const attribute of element.getAttributes()) {
            const name: string = attribute.getName();
            const index: number = name.indexOf(':');
            if (index === -1 || name.substring(index + 1) !== 'defaultValue') {
                continue;
            }
            if (context?.resolveNamespacePrefix(name.substring(0, index)) === COMPATIBILITY_ANNOTATIONS_NS) {
                return attribute.getValue();
            }
        }
        return undefined;
    }

    private libraryOf(element: XMLElement, inherited: string): string {
        const attr = element.getAttribute('datatypeLibrary');
        return attr ? attr.getValue() : inherited;
    }

    private buildGrammar(grammar: XMLElement, parent: Scope | undefined, inheritedLibrary: string): Pattern {
        const library: string = this.libraryOf(grammar, inheritedLibrary);
        const scope: Scope = new Scope(parent, library);
        for (const child of this.patternChildren(grammar)) {
            const name: string = this.localName(child);
            if (name === 'start') {
                scope.starts.push(child);
            } else if (name === 'define') {
                const defineName: string = child.getAttribute('name')?.getValue() ?? '';
                if (!scope.definitions.has(defineName)) {
                    scope.definitions.set(defineName, []);
                }
                scope.definitions.get(defineName)!.push(child);
            }
        }
        if (scope.starts.length === 0) {
            throw new Error('RelaxNG grammar has no start element');
        }
        const start: Pattern = this.combine(scope.starts, scope, library, 'start element');
        const previous: boolean = this.loopDetection;
        this.loopDetection = false;
        scope.definitions.forEach((_parts: XMLElement[], name: string) => this.resolveRef(scope, name));
        this.loopDetection = previous;
        return start;
    }

    private combine(parts: XMLElement[], scope: Scope, library: string, what: string): Pattern {
        const methods: Set<string> = new Set<string>();
        let withoutCombine: number = 0;
        for (const part of parts) {
            const method: string | undefined = part.getAttribute('combine')?.getValue();
            if (method === undefined) {
                withoutCombine++;
            } else {
                methods.add(method);
            }
        }
        if (parts.length > 1 && withoutCombine > 1) {
            throw new Error('More than one ' + what + ' without a combine attribute');
        }
        if (methods.size > 1) {
            throw new Error('Conflicting combine attributes for ' + what);
        }
        const patterns: Pattern[] = parts.map((part: XMLElement) => this.buildGroup(part, scope, this.libraryOf(part, library)));
        if (patterns.length === 1) {
            return patterns[0];
        }
        const interleave: boolean = methods.has('interleave');
        let result: Pattern = patterns[0];
        for (let i: number = 1; i < patterns.length; i++) {
            result = interleave ? this.pool.interleave(result, patterns[i]) : this.pool.choice(result, patterns[i]);
        }
        return result;
    }

    private resolveRef(scope: Scope | undefined, name: string): Pattern {
        if (!scope) {
            throw new Error('RelaxNG parentRef "' + name + '" used outside of a nested grammar');
        }
        const existing: RefPattern | undefined = scope.refs.get(name);
        if (existing) {
            if (this.loopDetection && this.active.has(existing)) {
                throw new Error('The definition of "' + name + '" refers to itself without going through an element');
            }
            return existing;
        }
        const parts: XMLElement[] | undefined = scope.definitions.get(name);
        if (!parts) {
            throw new Error('RelaxNG reference to undefined pattern "' + name + '"');
        }
        const ref: RefPattern = this.pool.ref(name);
        scope.refs.set(name, ref);
        this.active.add(ref);
        try {
            ref.setTarget(this.combine(parts, scope, scope.libraryAtGrammar, 'definition of "' + name + '"'));
        } finally {
            this.active.delete(ref);
        }
        return ref;
    }

    private buildGroup(element: XMLElement, scope: Scope, library: string, skip: number = 0): Pattern {
        const children: XMLElement[] = this.patternChildren(element).slice(skip);
        if (children.length === 0) {
            return this.pool.empty;
        }
        let result: Pattern = this.buildPattern(children[0], scope, library);
        for (let i: number = 1; i < children.length; i++) {
            result = this.pool.group(result, this.buildPattern(children[i], scope, library));
        }
        return result;
    }

    private buildFold(element: XMLElement, scope: Scope, library: string, join: (a: Pattern, b: Pattern) => Pattern): Pattern {
        const children: XMLElement[] = this.patternChildren(element);
        if (children.length === 0) {
            return this.pool.notAllowed;
        }
        let result: Pattern = this.buildPattern(children[0], scope, library);
        for (let i: number = 1; i < children.length; i++) {
            result = join(result, this.buildPattern(children[i], scope, library));
        }
        return result;
    }

    private buildPattern(element: XMLElement, scope: Scope, inheritedLibrary: string): Pattern {
        const library: string = this.libraryOf(element, inheritedLibrary);
        const name: string = this.localName(element);
        switch (name) {
            case 'empty':
                return this.pool.empty;
            case 'text':
                return this.pool.text;
            case 'notAllowed':
                return this.pool.notAllowed;
            case 'element': {
                const children: XMLElement[] = this.patternChildren(element);
                if (children.length === 0) {
                    throw new Error('RelaxNG element pattern without a name class');
                }
                const nameClass: NameClass = this.buildNameClass(children[0]);
                const outerActive: Set<RefPattern> = this.active;
                this.active = new Set<RefPattern>();
                const content: Pattern = this.buildGroup(element, scope, library, 1);
                this.active = outerActive;
                const created: ElementPattern = this.pool.element(nameClass, content) as ElementPattern;
                this.elementPatterns.push(created);
                return created;
            }
            case 'attribute': {
                const children: XMLElement[] = this.patternChildren(element);
                if (children.length === 0) {
                    throw new Error('RelaxNG attribute pattern without a name class');
                }
                const nameClass: NameClass = this.buildNameClass(children[0]);
                this.checkAttributeName(nameClass);
                if (children.length === 2) {
                    this.idPositions.add(children[1]);
                }
                const content: Pattern = children.length > 1 ? this.buildGroup(element, scope, library, 1) : this.pool.text;
                return this.pool.attribute(nameClass, content, this.defaultValueOf(element));
            }
            case 'group':
                return this.buildFold(element, scope, library, (a: Pattern, b: Pattern) => this.pool.group(a, b));
            case 'interleave':
                return this.buildFold(element, scope, library, (a: Pattern, b: Pattern) => this.pool.interleave(a, b));
            case 'choice':
                return this.buildFold(element, scope, library, (a: Pattern, b: Pattern) => this.pool.choice(a, b));
            case 'optional':
                return this.pool.optional(this.buildGroup(element, scope, library));
            case 'zeroOrMore':
                return this.pool.zeroOrMore(this.buildGroup(element, scope, library));
            case 'oneOrMore':
                return this.pool.oneOrMore(this.buildGroup(element, scope, library));
            case 'mixed':
                return this.pool.interleave(this.pool.text, this.buildGroup(element, scope, library));
            case 'list':
                return this.pool.list(this.buildGroup(element, scope, library));
            case 'ref':
                return this.resolveRef(scope, element.getAttribute('name')?.getValue() ?? '');
            case 'parentRef':
                return this.resolveRef(scope.parent, element.getAttribute('name')?.getValue() ?? '');
            case 'grammar':
                return this.buildGrammar(element, scope, library);
            case 'data':
                return this.buildData(element, scope, library);
            case 'value': {
                const typeAttr = element.getAttribute('type');
                const typeName: string = typeAttr ? typeAttr.getValue() : 'token';
                const datatype: Datatype = this.createDatatype(typeAttr ? library : '', typeName);
                const value: unknown | null = datatype.createValue(element.getText(), this.contexts.get(element) ?? null);
                if (value === null) {
                    throw new Error('Invalid value "' + element.getText() + '" for datatype ' + typeName);
                }
                this.checkIdPosition(element, datatype);
                return this.pool.value(datatype, value, typeName);
            }
            default:
                throw new Error('Unsupported RelaxNG pattern: ' + name);
        }
    }

    private getLibrary(uri: string): DatatypeLibrary {
        const library: DatatypeLibrary | null = this.libraries.createDatatypeLibrary(uri);
        if (!library) {
            throw new Error('Unsupported datatype library "' + uri + '"');
        }
        return library;
    }

    private createDatatype(libraryUri: string, typeName: string): Datatype {
        try {
            return this.getLibrary(libraryUri).createDatatype(typeName);
        } catch (error) {
            throw new Error(error instanceof Error ? error.message : String(error));
        }
    }

    private buildData(element: XMLElement, scope: Scope, library: string): Pattern {
        const typeName: string = element.getAttribute('type')?.getValue() ?? '';
        let except: Pattern | undefined;
        let datatype: Datatype;
        try {
            const builder: DatatypeBuilder = this.getLibrary(library).createDatatypeBuilder(typeName);
            for (const child of this.patternChildren(element)) {
                const childName: string = this.localName(child);
                if (childName === 'param') {
                    builder.addParameter(child.getAttribute('name')?.getValue() ?? '', child.getText(), this.contexts.get(child) ?? null);
                } else if (childName === 'except') {
                    const parts: Pattern = this.buildFold(child, scope, library, (a: Pattern, b: Pattern) => this.pool.choice(a, b));
                    except = except ? this.pool.choice(except, parts) : parts;
                }
            }
            datatype = builder.createDatatype();
        } catch (error) {
            throw new Error(error instanceof Error ? error.message : String(error));
        }
        this.checkIdPosition(element, datatype);
        return this.pool.data(datatype, except, typeName);
    }

    private checkIdPosition(element: XMLElement, datatype: Datatype): void {
        if (datatype.getIdType() !== IdType.NULL && !this.idPositions.has(element)) {
            throw new Error('ID, IDREF and IDREFS datatypes are only allowed as the content of an attribute pattern');
        }
    }

    private buildNameClass(element: XMLElement): NameClass {
        const name: string = this.localName(element);
        const ns: string = element.getAttribute('ns')?.getValue() ?? '';
        switch (name) {
            case 'name': {
                const lexical: string = element.getText().trim();
                const index: number = lexical.indexOf(':');
                return new NameNameClass(ns, index === -1 ? lexical : lexical.substring(index + 1));
            }
            case 'anyName': {
                const except: NameClass | undefined = this.buildExcept(element);
                const kinds: Set<string> = new Set<string>();
                except?.collectKinds(kinds);
                if (kinds.has('anyName')) {
                    throw new Error('The except clause of anyName cannot contain anyName');
                }
                return new AnyNameClass(except);
            }
            case 'nsName': {
                const except: NameClass | undefined = this.buildExcept(element);
                const kinds: Set<string> = new Set<string>();
                except?.collectKinds(kinds);
                if (kinds.has('anyName') || kinds.has('nsName')) {
                    throw new Error('The except clause of nsName cannot contain anyName or nsName');
                }
                return new NsNameClass(ns, except);
            }
            case 'choice': {
                const children: XMLElement[] = this.patternChildren(element);
                if (children.length === 0) {
                    throw new Error('RelaxNG empty name class choice');
                }
                let result: NameClass = this.buildNameClass(children[0]);
                for (let i: number = 1; i < children.length; i++) {
                    result = new ChoiceNameClass(result, this.buildNameClass(children[i]));
                }
                return result;
            }
            default:
                throw new Error('Unsupported RelaxNG name class: ' + name);
        }
    }

    private checkAttributeName(nameClass: NameClass): void {
        const names: NameNameClass[] = [];
        const namespaces: Set<string> = new Set<string>();
        nameClass.collect(names, namespaces);
        if (namespaces.has('http://www.w3.org/2000/xmlns')) {
            throw new Error('An attribute name cannot be in the namespace http://www.w3.org/2000/xmlns');
        }
        if (names.some((name: NameNameClass) => name.namespace === '' && name.localName === 'xmlns')) {
            throw new Error('An attribute cannot be named xmlns');
        }
    }

    private buildExcept(element: XMLElement): NameClass | undefined {
        const except: XMLElement | undefined = this.patternChildren(element).find((child: XMLElement) => this.localName(child) === 'except');
        if (!except) {
            return undefined;
        }
        const children: XMLElement[] = this.patternChildren(except);
        if (children.length === 0) {
            return undefined;
        }
        let result: NameClass = this.buildNameClass(children[0]);
        for (let i: number = 1; i < children.length; i++) {
            result = new ChoiceNameClass(result, this.buildNameClass(children[i]));
        }
        return result;
    }
}
