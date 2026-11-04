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

import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Catalog } from "./Catalog.js";
import { Constants } from "./Constants.js";
import { DOMBuilder } from "./DOMBuilder.js";
import { SAXParser } from "./SAXParser.js";
import { TextNode } from "./TextNode.js";
import { XMLAttribute } from "./XMLAttribute.js";
import { XMLElement } from "./XMLElement.js";
import { XMLNode } from "./XMLNode.js";
import { type AttributeDefault } from "./XMLSchemaParser.js";
import { RelaxNGGrammar } from "./grammar/RelaxNGGrammar.js";
import { PatternBuilder, RelaxNGSchema } from "./relaxng/PatternBuilder.js";
import { RelaxNGSyntax } from "./relaxng/RelaxNGSyntax.js";

type NameInfo = {
    lexicalName: string;
    localName: string;
    namespace?: string;
};

type RelaxNGParserOptions = {
    nested?: boolean;
    ancestors?: string[];
    content?: string;
    skipSyntaxCheck?: boolean;
};

export class RelaxNGParser {

    private readonly catalog?: Catalog;
    private readonly baseDir: string;
    private readonly ancestors: string[];
    private readonly root: XMLElement;
    private defaultPrefix: string = "";
    private defaultNamespace: string = Constants.RELAXNG_NS_URI;
    private definitionScopes: Map<XMLElement, Map<string, XMLElement>> = new Map();
    private parentMap: Map<XMLElement, XMLElement> = new Map();
    private elements: XMLElement[] = [];
    private divsRemoved: boolean = false;

    constructor(schemaPath: string, catalog?: Catalog, options: RelaxNGParserOptions = {}) {
        const absolutePath: string = isAbsolute(schemaPath) ? schemaPath : resolve(schemaPath);
        this.baseDir = dirname(absolutePath);
        this.ancestors = [...(options.ancestors ?? []), absolutePath];
        const contentHandler: DOMBuilder = new DOMBuilder();
        const parser: SAXParser = new SAXParser();
        if (catalog) {
            this.catalog = catalog;
            parser.setCatalog(this.catalog);
        }
        parser.setContentHandler(contentHandler);
        if (options.content !== undefined) {
            parser.parseString(options.content);
        } else {
            parser.parseFile(absolutePath);
        }
        const documentRoot: XMLElement | undefined = contentHandler.getDocument()?.getRoot();
        if (!documentRoot) {
            throw new Error('RelaxNG schema "' + absolutePath + '" could not be parsed');
        }

        if (!options.skipSyntaxCheck) {
            try {
                RelaxNGSyntax.validate(documentRoot);
            } catch (error) {
                const message: string = error instanceof Error ? error.message : String(error);
                throw new Error('Invalid RelaxNG schema "' + absolutePath + '": ' + message);
            }
        }

        this.defaultPrefix = this.getPrefix(documentRoot);

        const xmlnsDefault: XMLAttribute | undefined = documentRoot.getAttribute("xmlns");
        if (xmlnsDefault) {
            this.defaultNamespace = xmlnsDefault.getValue();
        } else if (this.defaultPrefix) {
            const prefixedNs: XMLAttribute | undefined = documentRoot.getAttribute('xmlns:' + this.defaultPrefix);
            if (prefixedNs) {
                this.defaultNamespace = prefixedNs.getValue();
            }
        }
        if (!this.defaultNamespace) {
            this.defaultNamespace = Constants.RELAXNG_NS_URI;
        }

        const holder: XMLElement = new XMLElement("holder");
        holder.addElement(documentRoot);
        const initialContext: Map<string, string> = new Map<string, string>();
        if (xmlnsDefault) {
            initialContext.set("", this.defaultNamespace);
        }
        if (this.defaultPrefix) {
            initialContext.set(this.defaultPrefix, this.defaultNamespace);
        }
        this.removeForeign(holder, initialContext);
        this.normalizeSyntax(holder);
        const baseUri: string = pathToFileURL(absolutePath).href;
        this.replaceExternalRef(holder, baseUri);
        this.replaceIncludes(holder, baseUri);
        do {
            this.divsRemoved = false;
            this.removeDivs(holder);
        } while (this.divsRemoved);
        const schemaRoot: XMLElement | undefined = holder.getChildren()[0];
        if (!schemaRoot) {
            throw new Error('RelaxNG schema "' + absolutePath + '" does not have a RelaxNG root element');
        }
        this.root = schemaRoot;
        if (!(options.nested ?? false)) {
            this.nameAttribute(this.root, new Map<string, string>());
        }
    }

    getSchema(): RelaxNGSchema {
        return new PatternBuilder().build(this.root);
    }

    getGrammar(): RelaxNGGrammar {
        return new RelaxNGGrammar(this.getElements(), () => this.getSchema());
    }

    getElements(): Map<string, Map<string, AttributeDefault>> {
        const result: Map<string, Map<string, AttributeDefault>> = new Map<string, Map<string, AttributeDefault>>();

        this.definitionScopes = new Map<XMLElement, Map<string, XMLElement>>();
        this.definitionScopes.set(this.root, new Map<string, XMLElement>());
        this.harvestDefinitions(this.root, this.root);

        this.elements = [];
        this.parentMap = new Map<XMLElement, XMLElement>();
        this.harvestElements(this.root);

        const rootContext: Map<string, string> = this.augmentNamespaceContext(new Map<string, string>(), this.root);

        for (const element of this.elements) {
            const nameElement: XMLElement | undefined = this.findChildByLocalName(element, "name");
            if (!nameElement) {
                continue;
            }
            const elementInfo: NameInfo | undefined = this.extractNameInfo(nameElement);
            if (!elementInfo) {
                continue;
            }

            const defaults: Map<string, AttributeDefault> = new Map<string, AttributeDefault>();
            const visitedRefs: Set<string> = new Set<string>();
            this.collectAttributeDefaultsFromPattern(element, defaults, visitedRefs, true, rootContext, this.scopeOf(element));
            if (defaults.size === 0) {
                continue;
            }

            this.storeElementDefaults(result, elementInfo, defaults);
        }

        return result;
    }

    private storeElementDefaults(result: Map<string, Map<string, AttributeDefault>>, elementInfo: NameInfo, defaults: Map<string, AttributeDefault>): void {
        result.set(elementInfo.lexicalName, this.cloneAttributeDefaultMap(defaults));
        if (!result.has(elementInfo.localName)) {
            result.set(elementInfo.localName, this.cloneAttributeDefaultMap(defaults));
        }
        if (elementInfo.namespace) {
            const namespacedKey: string = this.buildAttributeKey(elementInfo.localName, elementInfo.namespace);
            result.set(namespacedKey, this.cloneAttributeDefaultMap(defaults));
        }
    }

    private cloneAttributeDefaultMap(source: Map<string, AttributeDefault>): Map<string, AttributeDefault> {
        const clone: Map<string, AttributeDefault> = new Map<string, AttributeDefault>();
        source.forEach((value: AttributeDefault, key: string) => {
            clone.set(key, {
                localName: value.localName,
                namespace: value.namespace,
                lexicalName: value.lexicalName,
                value: value.value
            });
        });
        return clone;
    }

    private collectAttributeDefaultsFromPattern(pattern: XMLElement, defaults: Map<string, AttributeDefault>, visitedRefs: Set<string>, allowElementTraversal: boolean, context: Map<string, string>, scope: XMLElement): void {
        const currentContext: Map<string, string> = this.augmentNamespaceContext(context, pattern);
        const localName: string = this.getLocalNameFromElement(pattern);
        if (localName === "attribute") {
            this.addAttributeDefault(pattern, defaults, currentContext);
            return;
        }
        if (localName === "ref" || localName === "parentRef") {
            const nameAttr: XMLAttribute | undefined = pattern.getAttribute("name");
            const refName: string | undefined = nameAttr?.getValue();
            if (!refName || visitedRefs.has(refName)) {
                return;
            }
            visitedRefs.add(refName);
            const targetScope: XMLElement = localName === "parentRef" ? this.scopeOf(this.parentMap.get(scope) ?? this.root) : scope;
            const referenced: XMLElement | undefined = this.definitionScopes.get(targetScope)?.get(refName);
            if (referenced) {
                this.collectAttributeDefaultsFromPattern(referenced, defaults, visitedRefs, allowElementTraversal, currentContext, targetScope);
            }
            return;
        }
        let childAllowTraversal: boolean = allowElementTraversal;
        if (localName === "element") {
            if (!allowElementTraversal) {
                return;
            }
            childAllowTraversal = false;
        }
        const childScope: XMLElement = localName === "grammar" ? pattern : scope;
        for (const child of pattern.getChildren()) {
            if (child.getNodeType() !== Constants.ELEMENT_NODE) {
                continue;
            }
            this.collectAttributeDefaultsFromPattern(child as XMLElement, defaults, visitedRefs, childAllowTraversal, currentContext, childScope);
        }
    }

    private addAttributeDefault(attributeElement: XMLElement, defaults: Map<string, AttributeDefault>, context: Map<string, string>): void {
        const defaultValue: string | undefined = this.findDefaultValue(attributeElement, context);
        if (defaultValue === undefined) {
            return;
        }
        const nameElement: XMLElement | undefined = this.findChildByLocalName(attributeElement, "name");
        if (!nameElement) {
            return;
        }
        const nameInfo: NameInfo | undefined = this.extractNameInfo(nameElement);
        if (!nameInfo) {
            return;
        }
        const attributeDefault: AttributeDefault = {
            localName: nameInfo.localName,
            namespace: nameInfo.namespace,
            lexicalName: nameInfo.lexicalName,
            value: defaultValue
        };
        this.setAttributeDefault(defaults, attributeDefault);
    }

    private extractNameInfo(nameElement: XMLElement): NameInfo | undefined {
        const lexicalName: string = nameElement.getText().trim();
        if (!lexicalName) {
            return undefined;
        }
        const nsAttr: XMLAttribute | undefined = nameElement.getAttribute("ns");
        let namespace: string | undefined = nsAttr ? nsAttr.getValue() : undefined;
        let localName: string = lexicalName;
        const separatorIndex: number = lexicalName.indexOf(":");
        if (separatorIndex !== -1) {
            localName = lexicalName.substring(separatorIndex + 1);
            if (!namespace) {
                const prefix: string = lexicalName.substring(0, separatorIndex);
                if (prefix === "xml") {
                    namespace = "http://www.w3.org/XML/1998/namespace";
                }
            }
        }
        return {
            lexicalName: lexicalName,
            localName: localName,
            namespace: namespace && namespace.length > 0 ? namespace : undefined
        };
    }

    private findDefaultValue(attribute: XMLElement, context: Map<string, string>): string | undefined {
        for (const attr of attribute.getAttributes()) {
            const name: string = attr.getName();
            const index: number = name.indexOf(":");
            if (index === -1 || name.substring(index + 1) !== "defaultValue") {
                continue;
            }
            if (context.get(name.substring(0, index)) === Constants.RELAXNG_COMPATIBILITY_NS_URI) {
                return attr.getValue();
            }
        }
        return this.findDefaultValueFromChildren(attribute, context);
    }

    private findDefaultValueFromChildren(attribute: XMLElement, context: Map<string, string>): string | undefined {
        // Search depth-first for any compatibility "defaultValue" element among descendants
        const stack: Array<{ node: XMLElement; context: Map<string, string> }> = [];
        for (const child of attribute.getChildren()) {
            if (child.getNodeType() === Constants.ELEMENT_NODE) {
                stack.push({ node: child as XMLElement, context: context });
            }
        }

        while (stack.length > 0) {
            const entry: { node: XMLElement; context: Map<string, string> } = stack.pop() as { node: XMLElement; context: Map<string, string> };
            const nodeContext: Map<string, string> = this.augmentNamespaceContext(entry.context, entry.node);
            if (this.isCompatibilityAnnotation(entry.node, nodeContext)) {
                return entry.node.getText().trim();
            }
            for (const child of entry.node.getChildren()) {
                if (child.getNodeType() === Constants.ELEMENT_NODE) {
                    stack.push({ node: child as XMLElement, context: nodeContext });
                }
            }
        }

        return undefined;
    }

    private setAttributeDefault(target: Map<string, AttributeDefault>, value: AttributeDefault): void {
        const key: string = this.buildAttributeKey(value.localName, value.namespace);
        const removals: string[] = [];
        target.forEach((existing: AttributeDefault, existingKey: string) => {
            if (existing.localName !== value.localName) {
                return;
            }
            const sameNamespace: boolean = existing.namespace === value.namespace;
            if (sameNamespace && existingKey === key) {
                return;
            }
            if (sameNamespace || (value.namespace && !existing.namespace)) {
                removals.push(existingKey);
            }
        });
        for (const removalKey of removals) {
            target.delete(removalKey);
        }
        target.set(key, {
            localName: value.localName,
            namespace: value.namespace,
            lexicalName: value.lexicalName,
            value: value.value
        });
    }

    private buildAttributeKey(name: string, namespace?: string): string {
        if (namespace) {
            return namespace + "|" + name;
        }
        return name;
    }

    private removeForeign(element: XMLElement, context: Map<string, string>): void {
        const currentContext: Map<string, string> = this.augmentNamespaceContext(context, element);
        const newContent: XMLNode[] = [];
        for (const node of element.getContent()) {
            const nodeType: number = node.getNodeType();
            if (nodeType === Constants.TEXT_NODE || nodeType === Constants.PROCESSING_INSTRUCTION_NODE) {
                newContent.push(node);
                continue;
            }

            if (nodeType === Constants.ELEMENT_NODE) {
                const child: XMLElement = node as XMLElement;
                const childContext: Map<string, string> = this.augmentNamespaceContext(currentContext, child);
                if (!this.isRelaxNGElement(child, childContext)) {
                    if (this.isCompatibilityAnnotation(child, childContext)) {
                        newContent.push(child);
                    }
                    continue;
                }
                this.removeForeign(child, childContext);
                newContent.push(child);
            }
        }
        element.setContent(newContent);
    }

    private nestedParser(resolved: string): RelaxNGParser {
        if (this.ancestors.includes(resolved)) {
            throw new Error('RelaxNG schema "' + resolved + '" includes or references itself');
        }
        return new RelaxNGParser(resolved, this.catalog, { nested: true, ancestors: this.ancestors });
    }

    private baseOf(element: XMLElement, base: string): string {
        const attr: XMLAttribute | undefined = element.getAttribute("xml:base");
        if (!attr) {
            return base;
        }
        try {
            return new URL(this.escapeUri(attr.getValue()), base).href;
        } catch {
            throw new Error('RelaxNG schema has an invalid xml:base value: ' + attr.getValue());
        }
    }

    private keepsWhitespace(element: XMLElement): boolean {
        const name: string = this.getLocalNameFromElement(element);
        return name === "value" || name === "param";
    }

    private inheritAttribute(source: XMLElement, target: XMLElement, name: string): void {
        const attr: XMLAttribute | undefined = source.getAttribute(name);
        if (attr && !target.hasAttribute(name)) {
            target.setAttribute(new XMLAttribute(name, attr.getValue()));
        }
    }

    private replaceExternalRef(element: XMLElement, base: string): void {
        const effectiveBase: string = this.baseOf(element, base);
        const newContent: XMLNode[] = [];
        for (const node of element.getContent()) {
            const nodeType: number = node.getNodeType();
            if (nodeType === Constants.TEXT_NODE) {
                const textNode: TextNode = node as TextNode;
                if (!this.isBlankText(textNode) || this.keepsWhitespace(element)) {
                    newContent.push(node);
                }
                continue;
            }
            if (nodeType === Constants.PROCESSING_INSTRUCTION_NODE) {
                newContent.push(node);
                continue;
            }
            if (nodeType === Constants.ELEMENT_NODE) {
                const child: XMLElement = node as XMLElement;
                if (this.getLocalNameFromElement(child) === "externalRef") {
                    const hrefAttr: XMLAttribute | undefined = child.getAttribute("href");
                    const href: string = hrefAttr?.getValue() ?? "";
                    const resolved: string | undefined = this.resolveHref(href, this.baseOf(child, effectiveBase));
                    if (!resolved) {
                        throw new Error('RelaxNG externalRef target not found: ' + href);
                    }
                    const referenced: XMLElement = this.nestedParser(resolved).getRootElement();
                    this.inheritAttribute(child, referenced, "ns");
                    newContent.push(referenced);
                    continue;
                }
                this.replaceExternalRef(child, effectiveBase);
                newContent.push(child);
            }
        }
        element.setContent(newContent);
    }

    private replaceIncludes(element: XMLElement, base: string): void {
        const effectiveBase: string = this.baseOf(element, base);
        const newContent: XMLNode[] = [];
        for (const node of element.getContent()) {
            const nodeType: number = node.getNodeType();
            if (nodeType === Constants.TEXT_NODE) {
                const textNode: TextNode = node as TextNode;
                if (!this.isBlankText(textNode) || this.keepsWhitespace(element)) {
                    newContent.push(node);
                }
                continue;
            }
            if (nodeType === Constants.PROCESSING_INSTRUCTION_NODE) {
                newContent.push(node);
                continue;
            }
            if (nodeType === Constants.ELEMENT_NODE) {
                const child: XMLElement = node as XMLElement;
                if (this.getLocalNameFromElement(child) === "include") {
                    const hrefAttr: XMLAttribute | undefined = child.getAttribute("href");
                    const href: string = hrefAttr?.getValue() ?? "";
                    const resolved: string | undefined = this.resolveHref(href, this.baseOf(child, effectiveBase));
                    if (!resolved) {
                        throw new Error('RelaxNG include target not found: ' + href);
                    }
                    const included: XMLElement = this.nestedParser(resolved).getRootElement();
                    if (this.getLocalNameFromElement(included) !== "grammar") {
                        throw new Error('RelaxNG include target "' + href + '" is not a grammar');
                    }
                    this.inheritAttribute(child, included, "ns");
                    this.removeOverriddenDefinitions(included, child);
                    const div: XMLElement = this.createRelaxNGElement("div");
                    for (const attr of child.getAttributes()) {
                        if (attr.getName() !== "href") {
                            div.setAttribute(new XMLAttribute(attr.getName(), attr.getValue()));
                        }
                    }
                    for (const includedChild of included.getChildren()) {
                        for (const attr of included.getAttributes()) {
                            const attrName: string = attr.getName();
                            if ((attrName.startsWith("xmlns:") || attrName === "ns" || attrName === "datatypeLibrary") && !includedChild.hasAttribute(attrName)) {
                                includedChild.setAttribute(new XMLAttribute(attrName, attr.getValue()));
                            }
                        }
                        div.addElement(includedChild);
                    }
                    for (const includeChild of child.getChildren()) {
                        div.addElement(includeChild);
                    }
                    newContent.push(div);
                    continue;
                }
                this.replaceIncludes(child, effectiveBase);
                newContent.push(child);
            }
        }
        element.setContent(newContent);
    }

    private removeOverriddenDefinitions(included: XMLElement, include: XMLElement): void {
        let overridesStart: boolean = false;
        const overriddenNames: Set<string> = new Set<string>();
        const scan = (parent: XMLElement): void => {
            for (const item of parent.getChildren()) {
                const itemName: string = this.getLocalNameFromElement(item);
                if (itemName === "start") {
                    overridesStart = true;
                } else if (itemName === "define") {
                    const defineName: string | undefined = item.getAttribute("name")?.getValue();
                    if (defineName) {
                        overriddenNames.add(defineName);
                    }
                } else if (itemName === "div") {
                    scan(item);
                }
            }
        };
        scan(include);
        if (!overridesStart && overriddenNames.size === 0) {
            return;
        }
        const availableNames: Set<string> = new Set<string>();
        let hasStart: boolean = false;
        for (const item of included.getChildren()) {
            const itemName: string = this.getLocalNameFromElement(item);
            if (itemName === "start") {
                hasStart = true;
            } else if (itemName === "define") {
                availableNames.add(item.getAttribute("name")?.getValue() ?? "");
            }
        }
        if (overridesStart && !hasStart) {
            throw new Error("RelaxNG include overrides start, but the included grammar has no start");
        }
        for (const overridden of overriddenNames) {
            if (!availableNames.has(overridden)) {
                throw new Error('RelaxNG include overrides "' + overridden + '", but the included grammar does not define it');
            }
        }
        const remaining: XMLNode[] = [];
        for (const node of included.getContent()) {
            if (node.getNodeType() === Constants.ELEMENT_NODE) {
                const item: XMLElement = node as XMLElement;
                const itemName: string = this.getLocalNameFromElement(item);
                if (itemName === "start" && overridesStart) {
                    continue;
                }
                if (itemName === "define" && overriddenNames.has(item.getAttribute("name")?.getValue() ?? "")) {
                    continue;
                }
            }
            remaining.push(node);
        }
        included.setContent(remaining);
    }

    private removeDivs(element: XMLElement): void {
        const newContent: XMLNode[] = [];
        for (const node of element.getContent()) {
            if (node.getNodeType() === Constants.ELEMENT_NODE) {
                const child: XMLElement = node as XMLElement;
                if (this.getLocalNameFromElement(child) === "div") {
                    for (const divChild of child.getChildren()) {
                        for (const attr of child.getAttributes()) {
                            const attrName: string = attr.getName();
                            if ((attrName === "ns" || attrName === "datatypeLibrary" || attrName.startsWith("xmlns:")) && !divChild.hasAttribute(attrName)) {
                                divChild.setAttribute(new XMLAttribute(attrName, attr.getValue()));
                            }
                        }
                    }
                    newContent.push(...child.getContent());
                    this.divsRemoved = true;
                } else {
                    newContent.push(child);
                }
            } else {
                newContent.push(node);
            }
        }
        element.setContent(newContent);
        for (const child of element.getChildren()) {
            this.removeDivs(child);
        }
    }

    private harvestDefinitions(element: XMLElement, grammar: XMLElement): void {
        if (this.getLocalNameFromElement(element) === "grammar" && element !== grammar) {
            this.definitionScopes.set(element, new Map<string, XMLElement>());
            for (const child of element.getChildren()) {
                this.harvestDefinitions(child, element);
            }
            return;
        }
        if (this.getLocalNameFromElement(element) === "define") {
            const nameAttr: XMLAttribute | undefined = element.getAttribute("name");
            const definitionName: string | undefined = nameAttr?.getValue();
            if (definitionName) {
                const scope: Map<string, XMLElement> = this.definitionScopes.get(grammar) ?? new Map<string, XMLElement>();
                this.definitionScopes.set(grammar, scope);
                if (scope.has(definitionName)) {
                    const existing: XMLElement = scope.get(definitionName)!;
                    const merged: XMLElement = new XMLElement(existing.getName());
                    merged.setContent([...existing.getContent(), ...element.getContent()]);
                    scope.set(definitionName, merged);
                } else {
                    scope.set(definitionName, element);
                }
            }
        }
        for (const child of element.getChildren()) {
            this.harvestDefinitions(child, grammar);
        }
    }

    private scopeOf(element: XMLElement): XMLElement {
        let current: XMLElement | undefined = element;
        while (current) {
            if (this.definitionScopes.has(current)) {
                return current;
            }
            current = this.parentMap.get(current);
        }
        return this.root;
    }

    private harvestElements(element: XMLElement): void {
        if (this.getLocalNameFromElement(element) === "element" && this.findChildByLocalName(element, "name")) {
            this.elements.push(element);
        }
        for (const child of element.getChildren()) {
            this.parentMap.set(child, element);
            this.harvestElements(child);
        }
    }

    private normalizeSyntax(element: XMLElement): void {
        for (const attr of element.getAttributes()) {
            const attrName: string = attr.getName();
            if (attrName === "name" || attrName === "type" || attrName === "combine") {
                attr.setValue(attr.getValue().replaceAll(/^[ \t\r\n]+|[ \t\r\n]+$/g, ""));
            } else if (attrName === "datatypeLibrary") {
                const escaped: string = this.escapeUri(attr.getValue());
                if (escaped !== "" && !/^[A-Za-z][A-Za-z0-9+.-]*:[^#]+$/.test(escaped)) {
                    throw new Error('RelaxNG datatypeLibrary "' + attr.getValue() + '" must be an absolute URI without a fragment identifier');
                }
                attr.setValue(escaped);
            }
        }
        if (this.getLocalNameFromElement(element) === "name") {
            const text: string = element.getText().replaceAll(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
            element.setContent([]);
            element.addString(text);
        }
        for (const child of element.getChildren()) {
            this.normalizeSyntax(child);
        }
    }

    private escapeUri(value: string): string {
        let result: string = "";
        for (const character of value) {
            const codePoint: number = character.codePointAt(0) as number;
            if (codePoint > 127 || codePoint <= 32 || codePoint === 127 || "<>\"{}|\\^`".includes(character)) {
                for (const byte of Buffer.from(character, "utf8")) {
                    result += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
                }
            } else {
                result += character;
            }
        }
        return result;
    }

    private nameAttribute(element: XMLElement, context: Map<string, string>, inheritedNs: string = ""): void {
        const currentContext: Map<string, string> = this.augmentNamespaceContext(context, element);
        const localName: string = this.getLocalNameFromElement(element);
        const isElementPattern: boolean = localName === "element";
        const isAttributePattern: boolean = localName === "attribute";
        const ownNsAttr: XMLAttribute | undefined = element.getAttribute("ns");
        const effectiveNs: string = ownNsAttr ? ownNsAttr.getValue() : inheritedNs;

        if (localName === "name" || localName === "nsName") {
            let resolved: string | undefined;
            if (localName === "name") {
                const lexical: string = element.getText().trim();
                const separatorIndex: number = lexical.indexOf(":");
                if (separatorIndex !== -1) {
                    const bound: string | undefined = currentContext.get(lexical.substring(0, separatorIndex));
                    if (bound === undefined) {
                        throw new Error('RelaxNG name "' + lexical + '" uses an undeclared namespace prefix');
                    }
                    resolved = bound;
                }
            }
            if (resolved === undefined && !ownNsAttr) {
                resolved = inheritedNs;
            }
            if (resolved !== undefined) {
                element.setAttribute(new XMLAttribute("ns", resolved));
            }
        }

        if ((isElementPattern || isAttributePattern) && element.hasAttribute("name")) {
            const nameValue: string = element.getAttribute("name")?.getValue() ?? "";
            const nameElement: XMLElement = this.createRelaxNGElement("name");
            nameElement.addString(nameValue);

            const separatorIndex: number = nameValue.indexOf(":");
            let nameNs: string;
            if (separatorIndex !== -1) {
                const bound: string | undefined = currentContext.get(nameValue.substring(0, separatorIndex));
                if (bound === undefined) {
                    throw new Error('RelaxNG name "' + nameValue + '" uses an undeclared namespace prefix');
                }
                nameNs = bound;
            } else if (ownNsAttr) {
                nameNs = ownNsAttr.getValue();
            } else {
                nameNs = isElementPattern ? inheritedNs : "";
            }
            nameElement.setAttribute(new XMLAttribute("ns", nameNs));

            element.removeAttribute("name");
            const content: XMLNode[] = [nameElement, ...element.getContent()];
            element.setContent(content);
        }
        for (const child of element.getChildren()) {
            this.nameAttribute(child, currentContext, effectiveNs);
        }
    }

    private augmentNamespaceContext(baseContext: Map<string, string>, element: XMLElement): Map<string, string> {
        const updated: Map<string, string> = new Map<string, string>(baseContext);
        for (const attribute of element.getAttributes()) {
            const attributeName: string = attribute.getName();
            if (attributeName === "xmlns") {
                updated.set("", attribute.getValue());
                continue;
            }
            if (attributeName.startsWith("xmlns:")) {
                const prefix: string = attributeName.substring(6);
                updated.set(prefix, attribute.getValue());
            }
        }
        if (!updated.has("xml")) {
            updated.set("xml", "http://www.w3.org/XML/1998/namespace");
        }
        return updated;
    }

    private resolveHref(href: string, base: string): string | undefined {
        if (!href) {
            return undefined;
        }

        let absolute: URL;
        try {
            absolute = new URL(this.escapeUri(href), base);
        } catch {
            return undefined;
        }
        if (absolute.hash !== "") {
            throw new Error('RelaxNG href must not contain a fragment identifier: ' + href);
        }

        const attempts: Array<string | undefined> = [];
        if (this.catalog) {
            attempts.push(this.catalog.matchSystem(absolute.href));
            attempts.push(this.catalog.matchURI(absolute.href));
            attempts.push(this.catalog.matchSystem(href));
            attempts.push(this.catalog.matchURI(href));
        }
        if (absolute.protocol === "file:") {
            attempts.push(fileURLToPath(absolute));
        }

        for (const attempt of attempts) {
            const normalized: string | undefined = this.normalizeResolvedPath(attempt);
            if (normalized) {
                return normalized;
            }
        }
        return undefined;
    }

    private normalizeResolvedPath(pathCandidate: string | undefined): string | undefined {
        if (!pathCandidate) {
            return undefined;
        }

        let normalized: string = pathCandidate;
        if (normalized.startsWith("file://")) {
            try {
                normalized = fileURLToPath(normalized);
            } catch {
                return undefined;
            }
        }

        if (isAbsolute(normalized)) {
            return existsSync(normalized) ? normalized : undefined;
        }

        const resolved: string = resolve(this.baseDir, normalized);
        return existsSync(resolved) ? resolved : undefined;
    }

    private createRelaxNGElement(localName: string): XMLElement {
        const qualifiedName: string = this.defaultPrefix ? this.defaultPrefix + ':' + localName : localName;
        return new XMLElement(qualifiedName);
    }

    private isBlankText(node: TextNode): boolean {
        return node.getValue().trim().length === 0;
    }

    private getLocalNameFromElement(element: XMLElement): string {
        return this.getLocalNameFromString(element.getName());
    }

    private getLocalNameFromString(name: string): string {
        const index: number = name.indexOf(":");
        return index === -1 ? name : name.substring(index + 1);
    }

    private getPrefix(element: XMLElement): string {
        const name: string = element.getName();
        const index: number = name.indexOf(":");
        return index === -1 ? "" : name.substring(0, index);
    }

    private isCompatibilityAnnotation(element: XMLElement, context: Map<string, string>): boolean {
        if (this.getLocalNameFromElement(element) !== "defaultValue") {
            return false;
        }
        const prefix: string = this.getPrefix(element);
        if (!prefix) {
            return false;
        }
        return context.get(prefix) === Constants.RELAXNG_COMPATIBILITY_NS_URI;
    }

    private isRelaxNGElement(element: XMLElement, context: Map<string, string>): boolean {
        const prefix: string = this.getPrefix(element);
        if (prefix) {
            return context.get(prefix) === Constants.RELAXNG_NS_URI;
        }
        return context.get("") === Constants.RELAXNG_NS_URI;
    }

    private findChildByLocalName(element: XMLElement, localName: string): XMLElement | undefined {
        for (const child of element.getChildren()) {
            if (this.getLocalNameFromElement(child) === localName) {
                return child;
            }
        }
        return undefined;
    }

    getRootElement(): XMLElement {
        return this.root;
    }
}