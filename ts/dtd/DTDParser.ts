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

import { Stats, closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { dirname, sep } from "node:path";
import { Catalog } from "../Catalog.js";
import { FileReader } from "../FileReader.js";
import { XMLUtils } from "../XMLUtils.js";
import { AttDecl } from "./AttDecl.js";
import { AttListDecl } from "./AttListDecl.js";
import { DTDGrammar } from "./DTDGrammar.js";
import { ElementDecl } from "./ElementDecl.js";
import { EntityDecl } from "./EntityDecl.js";
import { NotationDecl } from "./NotationDecl.js";

export class DTDParser {

    private grammar: DTDGrammar;
    private catalog: Catalog | undefined;
    private pointer: number = 0;
    private source: string = '';
    private currentFile: string = '';
    private baseDirectory: string = '';
    private validating: boolean = false;
    private overrideExistingDeclarations: boolean = false;
    private preexistingEntityKeys: Set<string> = new Set();
    private preexistingAttributeKeys: Map<string, Set<string>> = new Map();
    private unresolvedExternalEntities: Map<string, string> = new Map();
    private parsingInternalSubset: boolean = false;
    private xmlVersion: string = '1.0';
    private openConditionalSections: number = 0;

    constructor(grammar?: DTDGrammar, baseDirectory?: string) {
        if (grammar) {
            this.grammar = grammar;
        } else {
            this.grammar = new DTDGrammar();
        }
        if (baseDirectory) {
            this.baseDirectory = baseDirectory;
        }
    }

    setGrammar(grammar: DTDGrammar): void {
        this.grammar = grammar;
    }

    setOverrideExistingDeclarations(override: boolean): void {
        this.overrideExistingDeclarations = override;
    }

    setValidating(validating: boolean): void {
        this.validating = validating;
    }

    setCatalog(catalog: Catalog) {
        this.catalog = catalog;
    }

    setXmlVersion(version: string): void {
        if (version === '1.1') {
            this.xmlVersion = '1.1';
            return;
        }
        this.xmlVersion = '1.0';
    }

    parseDTD(file: string): DTDGrammar {
        this.parseFile(file);
        this.grammar.processModels();
        if (this.openConditionalSections !== 0) {
            throw new Error("Malformed conditional section: missing closing ']]>'");
        }

        return this.grammar;
    }

    parseFile(file: string): DTDGrammar {
        const previousInternalSubsetFlag: boolean = this.parsingInternalSubset;
        this.parsingInternalSubset = false;
        try {
            this.source = '';
            let stats: Stats = statSync(file, { bigint: false, throwIfNoEntry: true });
            this.currentFile = file;
            let blockSize: number = stats.blksize;
            let fileHandle = openSync(file, 'r');
            let buffer = Buffer.alloc(blockSize);
            let bytesRead: number = readSync(fileHandle, buffer, 0, blockSize, 0);
            while (bytesRead > 0) {
                this.source += buffer.toString('utf8', 0, bytesRead);
                bytesRead = readSync(fileHandle, buffer, 0, blockSize, this.source.length);
            }
            closeSync(fileHandle);
            return this.parse();
        } finally {
            this.parsingInternalSubset = previousInternalSubsetFlag;
        }
    }

    parseString(source: string): DTDGrammar {
        const previousInternalSubsetFlag: boolean = this.parsingInternalSubset;
        this.parsingInternalSubset = true;
        try {
            this.source = source;
            this.parse();
            this.grammar.processModels();
            return this.grammar;
        } finally {
            this.parsingInternalSubset = previousInternalSubsetFlag;
        }
    }

    parse(): DTDGrammar {
        this.pointer = 0;
        this.preexistingEntityKeys = new Set<string>();
        this.preexistingAttributeKeys = new Map<string, Set<string>>();
        this.unresolvedExternalEntities.clear();
        this.openConditionalSections = 0;
        if (this.overrideExistingDeclarations) {
            for (const key of this.grammar.getEntitiesMap().keys()) {
                this.preexistingEntityKeys.add(key);
            }
            this.grammar.getAttributesMap().forEach((attributes: Map<string, AttDecl>, element: string) => {
                const attributeNames: Set<string> = new Set<string>();
                attributes.forEach((_value: AttDecl, name: string) => {
                    attributeNames.add(name);
                });
                this.preexistingAttributeKeys.set(element, attributeNames);
            });
        }
        while (this.pointer < this.source.length) {
            if (this.lookingAt('<!ELEMENT')) {
                let index: number = this.findDeclarationEnd(this.pointer);
                if (index === -1) {
                    throw new Error('Malformed element declaration');
                }
                let elementText: string = this.source.substring(this.pointer, index + '>'.length);
                let length = elementText.length;
                let elementDecl: ElementDecl = this.parseElementDeclaration(elementText);
                this.grammar.addElement(elementDecl, this.overrideExistingDeclarations);
                this.pointer += length;
                continue;
            }
            if (this.lookingAt('<!ATTLIST')) {
                let index: number = this.findDeclarationEnd(this.pointer);
                if (index === -1) {
                    throw new Error('Malformed attribute declaration');
                }
                let attListText: string = this.source.substring(this.pointer, index + '>'.length);
                let length = attListText.length;
                let attList: AttListDecl = this.parseAttributesListDeclaration(attListText);
                const preexisting: Set<string> | undefined = this.overrideExistingDeclarations ? this.preexistingAttributeKeys.get(attList.getName()) : undefined;
                this.grammar.addAttributes(attList.getName(), attList.getAttributes(), this.overrideExistingDeclarations, preexisting);
                this.pointer += length;
                continue;
            }
            if (this.lookingAt('<!ENTITY')) {
                let index: number = this.findDeclarationEnd(this.pointer);
                if (index === -1) {
                    throw new Error('Malformed entity declaration');
                }
                let entityDeclText: string = this.source.substring(this.pointer, index + '>'.length);
                let entityDecl: EntityDecl = this.parseEntityDeclaration(entityDeclText);
                const entityKey: string = entityDecl.isParameterEntity() ? `%${entityDecl.getName()}` : entityDecl.getName();
                const alreadyDeclared: boolean = this.grammar.getEntitiesMap().has(entityKey);
                const existedBeforeParse: boolean = this.preexistingEntityKeys.has(entityKey);
                if (alreadyDeclared && this.overrideExistingDeclarations && !existedBeforeParse) {
                    this.pointer += entityDeclText.length;
                    continue;
                }
                this.grammar.addEntity(entityDecl, this.overrideExistingDeclarations && existedBeforeParse);
                this.pointer += entityDeclText.length;
                continue;
            }
            if (this.lookingAt('<!NOTATION')) {
                let index: number = this.findDeclarationEnd(this.pointer);
                if (index === -1) {
                    throw new Error('Malformed notation declaration');
                }
                let notationDeclText: string = this.source.substring(this.pointer, index + '>'.length);
                if (XMLUtils.hasParameterEntity(notationDeclText)) {
                    notationDeclText = this.resolveEntities(notationDeclText);
                }
                let notation: NotationDecl = this.parseNotationDeclaration(notationDeclText);
                this.grammar.addNotation(notation, this.overrideExistingDeclarations);
                this.pointer += notationDeclText.length;
                continue;
            }
            if (this.lookingAt('<![')) {
                this.parseConditionalSection();
                continue;
            }
            if (this.lookingAt(']]>')) {
                this.endConditionalSection();
                continue;
            }
            if (this.lookingAt('<?')) {
                let index: number = this.source.indexOf('?>', this.pointer);
                if (index === -1) {
                    throw new Error('Malformed processing instruction');
                }
                // skip processing instructions
                this.pointer = index + '?>'.length;
                continue;
            }
            if (this.lookingAt('<!--')) {
                let index: number = this.source.indexOf('-->', this.pointer);
                if (index === -1) {
                    throw new Error('Malformed comment');
                }
                // skip comments
                this.pointer = index + '-->'.length;
                continue;
            }
            if (this.lookingAt('%')) {
                let index: number = this.source.indexOf(';', this.pointer);
                if (index == -1) {
                    throw new Error('Malformed entity reference');
                }
                let entityName: string = this.source.substring(this.pointer + '%'.length, index);
                let entity: EntityDecl | undefined = this.grammar.getParameterEntity(entityName);
                if (!entity && this.catalog) {
                    let entityLocation: string | undefined = this.catalog.matchPublic(entityName);
                    if (entityLocation) {
                        try {
                            // For external entity references like %xs-datatypes;, we need to create
                            // an entity that contains the entire external file content
                            let externalContent = this.readFileContent(entityLocation);
                            let externalEntity = new EntityDecl(entityName, true, externalContent, '', '', '');
                            this.grammar.addEntity(externalEntity, this.overrideExistingDeclarations);
                            entity = externalEntity;
                            // Also extract any entity declarations from the external file
                            // for potential future use
                            this.extractAndImportEntities(entityLocation);
                        } catch (parseError) {
                            console.warn(`Warning: Could not extract entities from ${entityLocation}: ${(parseError as Error).message}`);
                            // Continue without the external entities - they might be defined elsewhere
                        }
                    } else {
                        console.warn('entity not found in catalog: ' + entityName);
                    }
                }
                if (entity === undefined) {
                    throw new Error('Unknown entity: ' + entityName + ' in parsing loop');
                }
                let value: string = entity.getValue();
                if (value !== '') {
                    let start: string = this.source.substring(0, this.pointer);
                    let end: string = this.source.substring(index + ';'.length);
                    this.source = start + value + end;
                } else if (entity.getSystemId() !== '' || entity.getPublicId() !== '') {
                    let location = this.resolveEntity(entity.getPublicId(), entity.getSystemId());
                    let parser: DTDParser = new DTDParser(this.grammar);
                    parser.setXmlVersion(this.xmlVersion);
                    parser.setValidating(this.validating);
                    if (this.catalog) {
                        parser.setCatalog(this.catalog);
                    }
                    let externalGrammar: DTDGrammar = parser.parseFile(location);
                    this.grammar.merge(externalGrammar);
                    this.pointer = index + ';'.length;
                } else {
                    // empty entity, ignore
                    this.pointer = index + ';'.length;
                }
                continue;
            }
            let char: string = this.source.charAt(this.pointer);
            if (XMLUtils.isXmlSpace(char)) {
                this.pointer++;
                continue;
            }
            throw new Error('Error parsing ' + this.currentFile + ' at ' + this.source.substring(this.pointer - 10, this.pointer) + ' @ ' + this.source.substring(this.pointer, this.pointer + 30));
        }

        return this.grammar;
    }

    importAllEntities(sourceGrammar: DTDGrammar, targetGrammar: DTDGrammar): void {
        // Import all regular entities
        sourceGrammar.getEntitiesMap().forEach((entity, name) => {
            if (!targetGrammar.getEntity(name)) {
                targetGrammar.addEntity(entity);
            }
        });

        // Import elements if they don't conflict
        sourceGrammar.getElementDeclMap().forEach((element, name) => {
            if (!targetGrammar.getElementDeclMap().has(name)) {
                targetGrammar.addElement(element);
            }
        });

        // Import attribute lists
        sourceGrammar.getAttributesMap().forEach((attributes, elementName) => {
            let existingAttributes = targetGrammar.getAttributesMap().get(elementName);
            if (!existingAttributes || existingAttributes.size === 0) {
                targetGrammar.addAttributes(elementName, attributes);
            }
        });

        // Import notations
        sourceGrammar.getNotationsMap().forEach((notation, name) => {
            if (!targetGrammar.getNotationsMap().has(name)) {
                targetGrammar.addNotation(notation);
            }
        });
    }

    extractAndImportEntities(filePath: string): void {
        try {
            // Read the external DTD content and process it in the current parser context
            // This ensures parameter entities from the main DTD are available
            let content = this.readFileContent(filePath);
            let originalFile = this.currentFile;
            let originalSource = this.source;
            let originalPointer = this.pointer;

            // Temporarily switch context to external file
            this.currentFile = filePath;
            this.source = content;
            this.pointer = 0;

            try {
                // Parse the external DTD content in the current context
                this.parse();
            } finally {
                // Restore original context
                this.currentFile = originalFile;
                this.source = originalSource;
                this.pointer = originalPointer;
            }
        } catch (error) {
            if (this.validating) {
                throw error;
            }
            console.warn(`Warning: Could not parse external DTD file ${filePath}: ${(error as Error).message}`);

        }
    }

    private readFileContent(filePath: string): string {
        let stats: Stats = statSync(filePath, { bigint: false, throwIfNoEntry: true });
        let blockSize: number = stats.blksize;
        let fileHandle = openSync(filePath, 'r');
        let buffer = Buffer.alloc(blockSize);
        let content = '';
        let bytesRead: number = readSync(fileHandle, buffer, 0, blockSize, 0);
        while (bytesRead > 0) {
            content += buffer.toString('utf8', 0, bytesRead);
            bytesRead = readSync(fileHandle, buffer, 0, blockSize, content.length);
        }
        closeSync(fileHandle);
        return content;
    }

    endConditionalSection() {
        if (this.openConditionalSections === 0) {
            throw new Error("Malformed conditional section: unexpected closing ']]>' without matching '<!['");
        }
        this.openConditionalSections--;
        // jump over ]]>
        this.pointer += ']]>'.length;
    }

    parseConditionalSection() {
        this.pointer += '<!['.length;
        // skip spaces before section keyword
        for (; this.pointer < this.source.length; this.pointer++) {
            let char: string = this.source.charAt(this.pointer);
            if (!XMLUtils.isXmlSpace(char)) {
                break;
            }
        }
        // read section keyword
        let keyword: string = '';
        for (; this.pointer < this.source.length; this.pointer++) {
            let char: string = this.source.charAt(this.pointer);
            if (XMLUtils.isXmlSpace(char) || char === '[') {
                break;
            }
            keyword += char;
        }
        if (XMLUtils.hasParameterEntity(keyword)) {
            let resolvedKeyword: string = this.resolveEntities(keyword);
            const bracketIndex: number = resolvedKeyword.indexOf('[');
            if (bracketIndex !== -1) {
                const remainder: string = resolvedKeyword.substring(bracketIndex + 1);
                resolvedKeyword = resolvedKeyword.substring(0, bracketIndex);
                if (this.source.charAt(this.pointer) !== '[') {
                    this.source = this.source.substring(0, this.pointer) + '[' + remainder + this.source.substring(this.pointer);
                } else if (remainder.length > 0) {
                    const insertionIndex: number = this.pointer + 1;
                    this.source = this.source.substring(0, insertionIndex) + remainder + this.source.substring(insertionIndex);
                }
            }
            keyword = resolvedKeyword.trim();
        }
        if ('INCLUDE' === keyword) {
            // jump to the start of the content
            for (; this.pointer < this.source.length; this.pointer++) {
                let char: string = this.source.charAt(this.pointer);
                if (char === '[') {
                    break;
                }
            }
            this.pointer++;
            this.openConditionalSections++;
        } else if ('IGNORE' === keyword) {
            this.skipIgnoreSection();
        } else {
            throw new Error('Malformed conditional section');
        }
    }

    skipIgnoreSection() {
        let stack: number = 1;
        while (this.pointer < this.source.length) {
            if (this.lookingAt('<![')) {
                stack++;
                this.pointer += '<!['.length;
            } else if (this.lookingAt(']]>')) {
                stack--;
                this.pointer += ']]>'.length;
                if (stack === 0) {
                    return;
                }
            } else {
                this.pointer++;
            }
        }
        throw new Error("Malformed conditional section: conditional IGNORE section not closed with ']]>'");
    }

    resolveEntities(fragment: string, depth: number = 0): string {
        if (depth > 50) {
            throw new Error('Parameter entity resolution depth exceeded (possible recursion in parameter entities)');
        }

        let result: string = '';
        let inQuotes: boolean = false;
        let quoteChar: string = '';
        let index: number = 0;

        while (index < fragment.length) {
            const char: string = fragment.charAt(index);
            if (char === '%') {
                if (inQuotes && depth === 0) {
                    result += char;
                    index++;
                    continue;
                }
                const end: number = fragment.indexOf(';', index + 1);
                if (end === -1) {
                    throw new Error('Malformed parameter entity reference while resolving "' + fragment + '"');
                }
                const entityName: string = fragment.substring(index + 1, end).trim();
                if (entityName.length === 0) {
                    result += fragment.substring(index, end + 1);
                    index = end + 1;
                    continue;
                }
                const entity: EntityDecl | undefined = this.grammar.getParameterEntity(entityName);
                if (entity === undefined) {
                    const context: string = fragment.substring(index, Math.min(fragment.length, index + 80));
                    throw new Error('Unknown entity: ' + entityName + ' in resolveEntities while processing "' + context + '"');
                }
                if (entity.isExternal() && !entity.isExternalContentLoaded()) {
                    const externalText: string = this.loadExternalEntity(entity.getPublicId(), entity.getSystemId(), true, entity.getName(), entity.isParameterEntity());
                    entity.setValue(externalText);
                }
                let replacement: string = entity.getValue();
                if (replacement !== '') {
                    replacement = this.resolveEntities(replacement, depth + 1);

                    const beforeChar: string = result.length > 0 ? result.charAt(result.length - 1) : '';
                    const afterChar: string = (end + 1) < fragment.length ? fragment.charAt(end + 1) : '';
                    const originalBeforeChar: string = index > 0 ? fragment.charAt(index - 1) : '';
                    const originalAfterChar: string = afterChar;

                    if (this.needsSeparatorBefore(beforeChar, replacement, originalBeforeChar)) {
                        replacement = ' ' + replacement;
                    }
                    if (this.needsSeparatorAfter(afterChar, replacement, originalAfterChar)) {
                        replacement = replacement + ' ';
                    }

                    result += replacement;
                }
                index = end + 1;
                continue;
            }
            if (inQuotes) {
                result += char;
                index++;
                if (char === quoteChar) {
                    inQuotes = false;
                    quoteChar = '';
                }
                continue;
            }
            if (char === '"' || char === "'") {
                inQuotes = true;
                quoteChar = char;
                result += char;
                index++;
                continue;
            }
            result += char;
            index++;
        }

        return result;
    }

    parseEntityDeclaration(declaration: string): EntityDecl {
        this.requireWhitespaceAfterKeyword(declaration, '<!ENTITY', 'ENTITY declaration');
        let name: string = '';
        let i: number = '<!ENTITY'.length;
        let char: string = declaration.charAt(i);
        // skip spaces before % or entity name
        for (; i < declaration.length; i++) {
            char = declaration.charAt(i);
            if (!XMLUtils.isXmlSpace(char)) {
                break;
            }
        }
        let parameterEntity: boolean = false;
        if (char === '%') {
            parameterEntity = true;
            // skip spaces before name
            i++;
            for (; i < declaration.length; i++) {
                char = declaration.charAt(i);
                if (!XMLUtils.isXmlSpace(char)) {
                    break;
                }
            }
        }
        // get entity name
        for (; i < declaration.length; i++) {
            char = declaration.charAt(i);
            if (XMLUtils.isXmlSpace(char)) {
                break;
            }
            name += char;
        }

        // Validate entity name
        if (!XMLUtils.isValidXMLName(name)) {
            throw new Error(`Invalid entity name in DTD: "${name}" - XML names must be valid`);
        }

        if (XMLUtils.hasParameterEntity(name)) {
            name = this.resolveEntities(name);
        }
        // skip spaces before entity value or external id
        for (; i < declaration.length; i++) {
            char = declaration.charAt(i);
            if (!XMLUtils.isXmlSpace(char)) {
                break;
            }
        }
        if (parameterEntity) {
            // can have value or external id
            if (XMLUtils.lookingAt('PUBLIC', declaration, i)) {
                i += 'PUBLIC'.length;
                // skip spaces before public id
                for (; i < declaration.length; i++) {
                    char = declaration.charAt(i);
                    if (!XMLUtils.isXmlSpace(char)) {
                        break;
                    }
                }
                let separator: string = declaration.charAt(i);
                i++; // skip opening "
                // get public id
                let publicId: string = '';
                for (; i < declaration.length; i++) {
                    char = declaration.charAt(i);
                    if (char === separator) {
                        break;
                    }
                    publicId += char;
                }
                i++; // skip closing "
                if (XMLUtils.hasParameterEntity(publicId)) {
                    publicId = this.resolveEntities(publicId);
                }
                // skip spaces before system id
                for (; i < declaration.length; i++) {
                    char = declaration.charAt(i);
                    if (!XMLUtils.isXmlSpace(char)) {
                        break;
                    }
                }
                separator = declaration.charAt(i);
                i++; // skip opening "
                // get system id
                let systemId: string = '';
                for (; i < declaration.length; i++) {
                    char = declaration.charAt(i);
                    if (char === separator) {
                        break;
                    }
                    systemId += char;
                }
                if (XMLUtils.hasParameterEntity(systemId)) {
                    systemId = this.resolveEntities(systemId);
                }
                // Don't load external entity content during DTD parsing - load lazily when referenced
                return this.attachUnresolvedError(name, new EntityDecl(name, parameterEntity, '', systemId, publicId, ''));
            } else if (XMLUtils.lookingAt('SYSTEM', declaration, i)) {
                // skip spaces before system id
                i += 'SYSTEM'.length;
                for (; i < declaration.length; i++) {
                    char = declaration.charAt(i);
                    if (!XMLUtils.isXmlSpace(char)) {
                        break;
                    }
                }
                let separator: string = declaration.charAt(i);
                i++; // skip opening "
                // get system id
                let systemId: string = '';
                for (; i < declaration.length; i++) {
                    char = declaration.charAt(i);
                    if (char === separator) {
                        break;
                    }
                    systemId += char;
                }
                if (XMLUtils.hasParameterEntity(systemId)) {
                    systemId = this.resolveEntities(systemId);
                }
                // Don't load external entity content during DTD parsing - load lazily when referenced
                return this.attachUnresolvedError(name, new EntityDecl(name, parameterEntity, '', systemId, '', ''));
            } else {
                // get entity value
                let separator: string = declaration.charAt(i);
                i++; // skip opening "
                let value: string = '';
                for (; i < declaration.length; i++) {
                    char = declaration.charAt(i);
                    if (char === separator) {
                        break;
                    }
                    value += char;
                }
                const location: string = this.currentFile || this.baseDirectory || 'DTD';
                this.ensureParameterReferenceSyntax(value, 'parameter entity', `%${name}`, location);
                if (this.parsingInternalSubset && this.containsParameterEntityReference(value)) {
                    const where: string = location ? ` in ${location}` : '';
                    throw new Error(`Invalid parameter entity "%${name}"${where}: parameter entity references are not allowed in replacement text within the internal subset`);
                }
                value = this.normalizeEntityLiteral(value);
                this.validateParameterEntityValue(value, name, location);
                this.validateParsedEntityValue(value, name, location, true);
                return this.attachUnresolvedError(name, new EntityDecl(name, parameterEntity, value, '', '', ''));
            }
        } else {
            // Not a parameterEntity. Similar, but may declare NDATA
            if (XMLUtils.lookingAt('PUBLIC', declaration, i)) {
                i += 'PUBLIC'.length;
                // skip spaces before public id
                for (; i < declaration.length; i++) {
                    char = declaration.charAt(i);
                    if (!XMLUtils.isXmlSpace(char)) {
                        break;
                    }
                }
                let separator: string = declaration.charAt(i);
                i++; // skip "
                // get public id
                let publicId: string = '';
                for (; i < declaration.length; i++) {
                    char = declaration.charAt(i);
                    if (char === separator) {
                        break;
                    }
                    publicId += char;
                }
                i++; // skip closing "
                if (XMLUtils.hasParameterEntity(publicId)) {
                    publicId = this.resolveEntities(publicId);
                }
                // skip spaces before system id
                for (; i < declaration.length; i++) {
                    char = declaration.charAt(i);
                    if (!XMLUtils.isXmlSpace(char)) {
                        break;
                    }
                }
                separator = declaration.charAt(i);
                i++; // skip "
                // get system id
                let systemId: string = '';
                for (; i < declaration.length; i++) {
                    char = declaration.charAt(i);
                    if (char === separator) {
                        break;
                    }
                    systemId += char;
                }
                i++; // skip closing "
                if (XMLUtils.hasParameterEntity(systemId)) {
                    systemId = this.resolveEntities(systemId);
                }
                // skip spaces before NDATA
                for (; i < declaration.length; i++) {
                    char = declaration.charAt(i);
                    if (!XMLUtils.isXmlSpace(char)) {
                        break;
                    }
                }
                if (XMLUtils.lookingAt('NDATA', declaration, i)) {
                    i += 'NDATA'.length;
                    // skip spaces before ndata name
                    for (; i < declaration.length; i++) {
                        char = declaration.charAt(i);
                        if (!XMLUtils.isXmlSpace(char)) {
                            break;
                        }
                    }
                    // get ndata name
                    let ndata: string = '';
                    for (; i < declaration.length; i++) {
                        char = declaration.charAt(i);
                        if (XMLUtils.isXmlSpace(char)) {
                            break;
                        }
                        ndata += char;
                    }
                    if (XMLUtils.hasParameterEntity(ndata)) {
                        ndata = this.resolveEntities(ndata);
                    }
                    return this.attachUnresolvedError(name, new EntityDecl(name, parameterEntity, '', systemId, publicId, ndata));
                }
                const externalValue: string = this.loadExternalEntity(publicId, systemId, false, name, parameterEntity);
                return this.attachUnresolvedError(name, new EntityDecl(name, parameterEntity, externalValue, systemId, publicId, ''));
            } else if (XMLUtils.lookingAt('SYSTEM', declaration, i)) {
                i += 'SYSTEM'.length;
                // skip spaces before system id
                for (; i < declaration.length; i++) {
                    char = declaration.charAt(i);
                    if (!XMLUtils.isXmlSpace(char)) {
                        break;
                    }
                }
                let separator: string = declaration.charAt(i);
                i++; // skip "
                // get system id
                let systemId: string = '';
                for (; i < declaration.length; i++) {
                    char = declaration.charAt(i);
                    if (char === separator) {
                        break;
                    }
                    systemId += char;
                }
                if (XMLUtils.hasParameterEntity(systemId)) {
                    systemId = this.resolveEntities(systemId);
                }
                // skip spaces before NDATA
                for (; i < declaration.length; i++) {
                    char = declaration.charAt(i);
                    if (!XMLUtils.isXmlSpace(char)) {
                        break;
                    }
                }
                if (XMLUtils.lookingAt('NDATA', declaration, i)) {
                    i += 'NDATA'.length;
                    // skip spaces before ndata name
                    for (; i < declaration.length; i++) {
                        char = declaration.charAt(i);
                        if (!XMLUtils.isXmlSpace(char)) {
                            break;
                        }
                    }
                    // get ndata name
                    let ndata: string = '';
                    for (; i < declaration.length; i++) {
                        char = declaration.charAt(i);
                        if (XMLUtils.isXmlSpace(char)) {
                            break;
                        }
                        ndata += char;
                    }
                    if (XMLUtils.hasParameterEntity(ndata)) {
                        ndata = this.resolveEntities(ndata);
                    }
                    // NDATA entities are unparsed and shouldn't have content loaded
                    return this.attachUnresolvedError(name, new EntityDecl(name, parameterEntity, '', systemId, '', ndata));
                }
                const externalValue: string = this.loadExternalEntity('', systemId, false, name, parameterEntity);
                return this.attachUnresolvedError(name, new EntityDecl(name, parameterEntity, externalValue, systemId, '', ''));
            } else {
                // get entity value
                let separator: string = declaration.charAt(i);
                i++; // skip "
                let value: string = '';
                for (; i < declaration.length; i++) {
                    char = declaration.charAt(i);
                    if (char === separator) {
                        break;
                    }
                    value += char;
                }
                const location: string = this.currentFile || this.baseDirectory || 'DTD';
                this.ensureParameterReferenceSyntax(value, 'general entity', name, location);
                if (XMLUtils.hasParameterEntity(value)) {
                    if (this.parsingInternalSubset) {
                        const locationInfo: string = this.currentFile || this.baseDirectory || 'DTD';
                        const where: string = locationInfo ? ` in ${locationInfo}` : '';
                        throw new Error(`Invalid general entity "${name}"${where}: parameter entity references are not allowed in replacement text within the internal subset`);
                    }
                    value = this.resolveEntities(value);
                }
                value = this.normalizeEntityLiteral(value);
                this.validateParsedEntityValue(value, name, location, false);
                return this.attachUnresolvedError(name, new EntityDecl(name, parameterEntity, value, '', '', ''));
            }
        }
    }

    private attachUnresolvedError(name: string, entityDecl: EntityDecl): EntityDecl {
        const unresolvedError: string | undefined = this.unresolvedExternalEntities.get(name);
        if (unresolvedError) {
            entityDecl.markUnresolved(unresolvedError);
            this.unresolvedExternalEntities.delete(name);
        }
        return entityDecl;
    }

    private normalizeEntityLiteral(value: string): string {
        // XML 1.0 section 2.11: normalize CRLF and CR to LF within entity values.
        let normalized: string = value.replaceAll('\r\n', '\n');
        normalized = normalized.replaceAll('\r', '\n');
        return normalized;
    }

    private validateParameterEntityValue(content: string, entityName: string, location: string): void {
        if (!this.validating) {
            return;
        }
        if (content.length === 0) {
            return;
        }

        const where: string = location ? ` in ${location}` : '';

        let inSingleQuote: boolean = false;
        let inDoubleQuote: boolean = false;
        let parenDepth: number = 0;
        let index: number = 0;

        while (index < content.length) {
            const char: string = content.charAt(index);

            if (!inDoubleQuote && char === "'") {
                inSingleQuote = !inSingleQuote;
                index++;
                continue;
            }
            if (!inSingleQuote && char === '"') {
                inDoubleQuote = !inDoubleQuote;
                index++;
                continue;
            }
            if (inSingleQuote || inDoubleQuote) {
                index++;
                continue;
            }

            if (char === '(') {
                parenDepth++;
                index++;
                continue;
            }
            if (char === ')') {
                if (parenDepth === 0) {
                    throw new Error(`Invalid parameter entity "%${entityName}"${where}: unmatched ')' in replacement text`);
                }
                parenDepth--;
                index++;
                continue;
            }
            if (content.startsWith('<!--', index)) {
                const commentEnd: number = content.indexOf('-->', index + 4);
                if (commentEnd === -1) {
                    throw new Error(`Invalid parameter entity "%${entityName}"${where}: comment opened but not closed`);
                }
                index = commentEnd + 3;
                continue;
            }
            if (content.startsWith('<![', index)) {
                const sectionEnd: number = content.indexOf(']]>', index + 3);
                if (sectionEnd === -1) {
                    throw new Error(`Invalid parameter entity "%${entityName}"${where}: conditional section opened but not closed`);
                }
                index = sectionEnd + 3;
                continue;
            }
            if (content.startsWith('<!', index)) {
                const markupEnd: number = content.indexOf('>', index + 2);
                if (markupEnd === -1) {
                    throw new Error(`Invalid parameter entity "%${entityName}"${where}: markup declaration started but not closed`);
                }
                index = markupEnd + 1;
                continue;
            }

            index++;
        }

        if (inSingleQuote || inDoubleQuote) {
            throw new Error(`Invalid parameter entity "%${entityName}"${where}: quote mismatch in replacement text`);
        }
        if (parenDepth !== 0) {
            throw new Error(`Invalid parameter entity "%${entityName}"${where}: parentheses are not balanced`);
        }
    }

    private ensureParameterReferenceSyntax(text: string, entityType: string, entityLabel: string, location: string): void {
        if (!this.validating || text.length === 0) {
            return;
        }
        const where: string = location ? ` in ${location}` : '';
        let index: number = 0;
        while (index < text.length) {
            if (text.charAt(index) !== '%') {
                index++;
                continue;
            }
            const refEnd: number | null = this.readParameterEntityReference(text, index);
            if (refEnd === null) {
                throw new Error(`Invalid ${entityType} "${entityLabel}"${where}: malformed parameter entity reference in replacement text`);
            }
            index = refEnd + 1;
        }
    }

    private validateParsedEntityValue(content: string, entityName: string, location: string, isParameterEntity: boolean): void {
        if (!this.validating || content.length === 0) {
            return;
        }
        const where: string = location ? ` in ${location}` : '';
        const entityLabel: string = isParameterEntity ? `%${entityName}` : entityName;
        const entityType: string = isParameterEntity ? 'parameter entity' : 'general entity';
        if (!isParameterEntity) {
            this.ensureGeneralEntityDelimitersBalanced(content, entityLabel, where);
        }
        XMLUtils.ensureValidXmlCharacters(this.xmlVersion, content, `${entityType} "${entityLabel}" replacement text${where}`);
        let index: number = 0;
        while (index < content.length) {
            const char: string = content.charAt(index);
            if (char !== '&') {
                index++;
                continue;
            }

            if (index + 1 >= content.length) {
                throw new Error(`Invalid ${entityType} "${entityLabel}"${where}: unterminated entity reference in replacement text`);
            }

            const following: string = content.charAt(index + 1);
            if (following === '#') {
                let referenceIndex: number = index + 2;
                if (referenceIndex >= content.length) {
                    throw new Error(`Invalid ${entityType} "${entityLabel}"${where}: malformed character reference in replacement text`);
                }
                const radixChar: string = content.charAt(referenceIndex);
                let validDigits: RegExp;
                if (radixChar === 'x' || radixChar === 'X') {
                    referenceIndex++;
                    validDigits = /^[0-9a-fA-F]$/;
                } else {
                    validDigits = /^[0-9]$/;
                }
                let digitCount: number = 0;
                while (referenceIndex < content.length) {
                    const current: string = content.charAt(referenceIndex);
                    if (current === ';') {
                        break;
                    }
                    if (!validDigits.test(current)) {
                        throw new Error(`Invalid ${entityType} "${entityLabel}"${where}: malformed character reference in replacement text`);
                    }
                    digitCount++;
                    referenceIndex++;
                }
                if (digitCount === 0 || referenceIndex >= content.length || content.charAt(referenceIndex) !== ';') {
                    throw new Error(`Invalid ${entityType} "${entityLabel}"${where}: unterminated character reference in replacement text`);
                }
                index = referenceIndex + 1;
                continue;
            }

            if (!XMLUtils.isNameStartChar(following)) {
                throw new Error(`Invalid ${entityType} "${entityLabel}"${where}: unescaped '&' in replacement text`);
            }

            let refIndex: number = index + 2;
            while (refIndex < content.length && XMLUtils.isNameChar(content.charAt(refIndex))) {
                refIndex++;
            }
            if (refIndex >= content.length || content.charAt(refIndex) !== ';') {
                throw new Error(`Invalid ${entityType} "${entityLabel}"${where}: unterminated entity reference in replacement text`);
            }
            index = refIndex + 1;
        }
    }

    private ensureGeneralEntityDelimitersBalanced(content: string, entityLabel: string, where: string): void {
        const preview: string = this.decodeCharacterReferencesForValidation(content);
        let index: number = 0;
        let inSingleQuote: boolean = false;
        let inDoubleQuote: boolean = false;
        while (index < preview.length) {
            const char: string = preview.charAt(index);
            if (!inDoubleQuote && char === "'") {
                inSingleQuote = !inSingleQuote;
                index++;
                continue;
            }
            if (!inSingleQuote && char === '"') {
                inDoubleQuote = !inDoubleQuote;
                index++;
                continue;
            }
            if (inSingleQuote || inDoubleQuote) {
                index++;
                continue;
            }

            if (preview.startsWith('<![CDATA[', index)) {
                const closing: number = preview.indexOf(']]>', index + '<![CDATA['.length);
                if (closing === -1) {
                    throw new Error(`Invalid general entity "${entityLabel}"${where}: CDATA section start delimiter appears without matching end`);
                }
                index = closing + ']]>'.length;
                continue;
            }
            if (preview.startsWith('<!--', index)) {
                const closing: number = preview.indexOf('-->', index + '<!--'.length);
                if (closing === -1) {
                    throw new Error(`Invalid general entity "${entityLabel}"${where}: comment opened but not closed in replacement text`);
                }
                index = closing + '-->'.length;
                continue;
            }
            if (preview.startsWith('<?', index)) {
                const closing: number = preview.indexOf('?>', index + '<?'.length);
                if (closing === -1) {
                    throw new Error(`Invalid general entity "${entityLabel}"${where}: processing instruction opened but not closed in replacement text`);
                }
                index = closing + '?>'.length;
                continue;
            }
            index++;
        }
    }

    private decodeCharacterReferencesForValidation(content: string): string {
        let result: string = '';
        let index: number = 0;
        while (index < content.length) {
            const char: string = content.charAt(index);
            if (char !== '&') {
                result += char;
                index++;
                continue;
            }

            if (content.startsWith('&#x', index) || content.startsWith('&#X', index)) {
                const semi: number = content.indexOf(';', index + 3);
                if (semi === -1) {
                    result += '&';
                    index++;
                    continue;
                }
                const hexDigits: string = content.substring(index + 3, semi);
                const value: number = Number.parseInt(hexDigits, 16);
                if (!Number.isNaN(value)) {
                    result += String.fromCodePoint(value);
                }
                index = semi + 1;
                continue;
            }
            if (content.startsWith('&#', index)) {
                const semi: number = content.indexOf(';', index + 2);
                if (semi === -1) {
                    result += '&';
                    index++;
                    continue;
                }
                const digits: string = content.substring(index + 2, semi);
                const value: number = Number.parseInt(digits, 10);
                if (!Number.isNaN(value)) {
                    result += String.fromCodePoint(value);
                }
                index = semi + 1;
                continue;
            }
            if (content.startsWith('&lt;', index)) {
                result += '<';
                index += 4;
                continue;
            }
            if (content.startsWith('&gt;', index)) {
                result += '>';
                index += 4;
                continue;
            }
            if (content.startsWith('&amp;', index)) {
                result += '&';
                index += 5;
                continue;
            }
            if (content.startsWith('&apos;', index)) {
                result += "'";
                index += 6;
                continue;
            }
            if (content.startsWith('&quot;', index)) {
                result += '"';
                index += 6;
                continue;
            }
            result += char;
            index++;
        }
        return result;
    }

    parseNotationDeclaration(declaration: string): NotationDecl {
        this.requireWhitespaceAfterKeyword(declaration, '<!NOTATION', 'NOTATION declaration');
        if (this.parsingInternalSubset && this.hasParameterEntityReferenceOutsideLiterals(declaration)) {
            const location: string = this.currentFile || this.baseDirectory || 'DTD';
            const where: string = location ? ` in ${location}` : '';
            throw new Error(`Invalid NOTATION declaration${where}: parameter entity references are not allowed inside markup declarations in the internal subset`);
        }
        let name: string = '';
        let i: number = '<!NOTATION'.length;
        let char: string = declaration.charAt(i);
        // skip spaces before notation name
        for (; i < declaration.length; i++) {
            char = declaration.charAt(i);
            if (!XMLUtils.isXmlSpace(char)) {
                break;
            }
        }
        // get notation name
        for (; i < declaration.length; i++) {
            char = declaration.charAt(i);
            if (XMLUtils.isXmlSpace(char)) {
                break;
            }
            name += char;
        }

        // Validate notation name
        if (!XMLUtils.isValidXMLName(name)) {
            throw new Error(`Invalid notation name in DTD: "${name}" - XML names must be valid`);
        }

        // skip spaces before external id
        for (; i < declaration.length; i++) {
            char = declaration.charAt(i);
            if (!XMLUtils.isXmlSpace(char)) {
                break;
            }
        }
        let publicId: string = '';
        let systemId: string = '';
        if (XMLUtils.lookingAt('PUBLIC', declaration, i)) {
            i += 'PUBLIC'.length;
            // skip spaces before public id
            for (; i < declaration.length; i++) {
                char = declaration.charAt(i);
                if (!XMLUtils.isXmlSpace(char)) {
                    break;
                }
            }
            let separator: string = declaration.charAt(i);
            i++; // skip opening "
            // get public id
            for (; i < declaration.length; i++) {
                char = declaration.charAt(i);
                if (char === separator) {
                    break;
                }
                publicId += char;
            }
            i++; // skip closing "
            if (XMLUtils.hasParameterEntity(publicId)) {
                publicId = this.resolveEntities(publicId);
            }
            // skip spaces before system id
            for (; i < declaration.length; i++) {
                char = declaration.charAt(i);
                if (!XMLUtils.isXmlSpace(char)) {
                    break;
                }
            }
            separator = declaration.charAt(i);
            i++; // skip opening "
            // get system id
            for (; i < declaration.length; i++) {
                char = declaration.charAt(i);
                if (char === separator) {
                    break;
                }
                systemId += char;
            }
        } else if (XMLUtils.lookingAt('SYSTEM', declaration, i)) {
            i += 'SYSTEM'.length;
            // skip spaces before system id
            for (; i < declaration.length; i++) {
                char = declaration.charAt(i);
                if (!XMLUtils.isXmlSpace(char)) {
                    break;
                }
            }
            let separator: string = declaration.charAt(i);
            i++; // skip opening "
            // get system id
            for (; i < declaration.length; i++) {
                char = declaration.charAt(i);
                if (char === separator) {
                    break;
                }
                systemId += char;
            }
        } else {
            throw new Error('Malformed notation declaration');
        }
        return new NotationDecl(name, publicId, systemId);
    }

    parseAttributesListDeclaration(declaration: string): AttListDecl {
        this.requireWhitespaceAfterKeyword(declaration, '<!ATTLIST', 'ATTLIST declaration');
        if (this.parsingInternalSubset && this.hasParameterEntityReferenceOutsideLiterals(declaration)) {
            const location: string = this.currentFile || this.baseDirectory || 'DTD';
            const where: string = location ? ` in ${location}` : '';
            throw new Error(`Invalid ATTLIST declaration${where}: parameter entity references are not allowed inside markup declarations in the internal subset`);
        }
        // replace all entities in the declaration
        declaration = this.resolveEntities(declaration);

        let i: number = '<!ATTLIST'.length;
        let char: string = declaration.charAt(i);
        // skip spaces before list name
        for (; i < declaration.length; i++) {
            char = declaration.charAt(i);
            if (!XMLUtils.isXmlSpace(char)) {
                break;
            }
        }
        // get list name
        let name: string = '';
        for (; i < declaration.length; i++) {
            char = declaration.charAt(i);
            if (XMLUtils.isXmlSpace(char)) {
                break;
            }
            name += char;
        }
        // skip spaces before attributes declaration
        for (; i < declaration.length; i++) {
            char = declaration.charAt(i);
            if (!XMLUtils.isXmlSpace(char)) {
                break;
            }
        }
        let attributesText: string = '';
        for (; i < declaration.length; i++) {
            char = declaration.charAt(i);
            if (char === '>') {
                break;
            }
            attributesText += char;
        }

        // Validate element name in ATTLIST declaration
        if (!XMLUtils.isValidXMLName(name)) {
            throw new Error(`Invalid element name in ATTLIST declaration: "${name}"`);
        }

        // Expand parameter entities in attributes text before parsing (external subsets only)
        attributesText = this.expandParameterEntities(attributesText);

        let list: AttListDecl = new AttListDecl(name, attributesText)
        this.validateAttributeDefaultEntities(list);
        return list;
    }

    parseElementDeclaration(declaration: string): ElementDecl {
        this.requireWhitespaceAfterKeyword(declaration, '<!ELEMENT', 'ELEMENT declaration');
        if (this.parsingInternalSubset && this.hasParameterEntityReferenceOutsideLiterals(declaration)) {
            const location: string = this.currentFile || this.baseDirectory || 'DTD';
            const where: string = location ? ` in ${location}` : '';
            throw new Error(`Invalid ELEMENT declaration${where}: parameter entity references are not allowed inside markup declarations in the internal subset`);
        }
        // replace entities in the declaration
        declaration = this.resolveEntities(declaration);

        let name: string = '';
        let i: number = '<!ELEMENT'.length;
        let char: string = declaration.charAt(i);
        // skip spaces before element name
        for (; i < declaration.length; i++) {
            char = declaration.charAt(i);
            if (!XMLUtils.isXmlSpace(char)) {
                break;
            }
        }
        // get element name
        for (; i < declaration.length; i++) {
            char = declaration.charAt(i);
            if (XMLUtils.isXmlSpace(char)) {
                break;
            }
            name += char;
        }

        // Validate element name
        if (!XMLUtils.isValidXMLName(name)) {
            throw new Error(`Invalid element name in DTD: "${name}" - XML names must be valid`);
        }

        // skip spaces before content spec
        for (; i < declaration.length; i++) {
            char = declaration.charAt(i);
            if (!XMLUtils.isXmlSpace(char)) {
                break;
            }
        }
        // get content spec
        let contentSpec: string = '';
        for (; i < declaration.length; i++) {
            char = declaration.charAt(i);
            if (char === '>') {
                break;
            }
            contentSpec += char;
        }
        return new ElementDecl(name, contentSpec);
    }

    lookingAt(text: string): boolean {
        let length: number = text.length;
        if (this.pointer + length > this.source.length) {
            return false;
        }
        for (let i = 0; i < length; i++) {
            if (this.source[this.pointer + i] !== text[i]) {
                return false;
            }
        }
        return true;
    }

    findDeclarationEnd(startPointer: number): number {
        let i = startPointer;
        let inQuotes = false;
        let quoteChar = '';

        // Skip past the opening tag (e.g., "<!ENTITY", "<!ATTLIST")
        while (i < this.source.length && !XMLUtils.isXmlSpace(this.source.charAt(i)) && this.source.charAt(i) !== '>') {
            i++;
        }

        while (i < this.source.length) {
            let char = this.source.charAt(i);

            if (!inQuotes && (char === '"' || char === "'")) {
                // Starting a quoted section
                inQuotes = true;
                quoteChar = char;
            } else if (inQuotes && char === quoteChar) {
                // Ending a quoted section
                inQuotes = false;
                quoteChar = '';
            } else if (!inQuotes && char === '>') {
                // Found the end of the declaration
                return i;
            }

            i++;
        }

        return -1; // Not found
    }

    resolveEntity(publicId: string, systemId: string): string {
        let location: string | undefined;
        if (systemId !== '' && !systemId.startsWith('http')) {
            const localLocation: string = this.makeAbsolute(systemId);
            if (existsSync(localLocation)) {
                location = localLocation;
            }
        }
        if (!location) {
            location = this.catalog?.resolveEntity(publicId, systemId);
        }
        if (location) {
            return location;
        }
        if (systemId.startsWith('http')) {
            return systemId;
        }
        throw new Error('Entity not found: "' + publicId + '" "' + systemId + '"');
    }

    makeAbsolute(uri: string): string {
        // Use base directory if available (for inline DTDs), otherwise use current file directory
        let basePath: string = this.baseDirectory || dirname(this.currentFile);
        return basePath + sep + uri;
    }

    loadExternalEntity(publicId: string, systemId: string, isReferenced: boolean = false, entityName: string = '', isParameterEntity: boolean = false): string {
        let reader: FileReader | undefined;
        try {
            let location = this.resolveEntity(publicId, systemId);

            // Use FileReader to properly handle different encodings (UTF-8, UTF-16, etc.)
            reader = new FileReader(location);
            let content = '';
            while (reader.dataAvailable()) {
                content += reader.read();
            }

            // Validate that content is valid XML text (not binary)
            this.validateTextContent(content, location);

            // XML 1.0 section 2.11: normalize line endings to LF
            content = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n');

            // Remove optional text declaration so entity replacement text contains only actual content
            content = this.removeTextDeclaration(content);

            const contextName: string = entityName || systemId || publicId || '[external entity]';
            if (isParameterEntity) {
                this.validateParameterEntityValue(content, contextName, location);
            }
            this.validateParsedEntityValue(content, contextName, location, isParameterEntity);

            // Don't trim - preserve original content including whitespace/newlines
            if (entityName) {
                this.unresolvedExternalEntities.delete(entityName);
            }
            return content;
        } catch (error) {
            const identifier: string = publicId || systemId;
            const isRemote: boolean = identifier.startsWith('http://') || identifier.startsWith('https://');
            const errorMessage: string = `Could not load external entity "${identifier}": ${(error as Error).message}`;
            if (isReferenced || (this.validating && !isRemote)) {
                throw new Error(errorMessage);
            }
            if (entityName) {
                this.unresolvedExternalEntities.set(entityName, errorMessage);
            }
            return '';
        } finally {
            // Ensure file handle is always closed to prevent EMFILE errors
            if (reader) {
                try {
                    reader.closeFile();
                } catch (closeError) {
                    console.error(`Error closing file reader: ${(closeError as Error).message}`);
                }
            }
        }
    }

    private validateTextContent(content: string, location: string): void {
        // Check for null bytes and other binary indicators
        if (content.includes('\0')) {
            throw new Error(`External entity "${location}" contains binary data (null bytes) and cannot be used as XML text`);
        }

        // Skip BOM if present (UTF-8: \uFEFF or UTF-16: \uFEFF)
        let textContent = content;
        if (textContent.codePointAt(0) === 0xFEFF) {
            textContent = textContent.substring(1);
        }

        // Allow a single leading text declaration per XML 1.0 section 4.3.1, flag any others
        const firstNonWhitespace = textContent.search(/\S/);
        if (firstNonWhitespace !== -1 && textContent.startsWith('<?xml', firstNonWhitespace)) {
            const textDeclEnd = textContent.indexOf('?>', firstNonWhitespace);
            if (textDeclEnd === -1) {
                throw new Error(`External entity "${location}" has an unterminated text declaration`);
            }

            const textDeclaration = textContent.substring(firstNonWhitespace, textDeclEnd + 2);
            if (!/encoding\s*=\s*(['"]).+?\1/i.test(textDeclaration)) {
                throw new Error(`External entity "${location}" text declaration must include an encoding pseudo-attribute`);
            }

            const remainingContent = textContent.substring(textDeclEnd + 2);
            if (remainingContent.match(/<\?xml\s+/i)) {
                throw new Error(`External entity "${location}" contains multiple XML declarations`);
            }
        } else if (textContent.match(/<\?xml\s+/i)) {
            throw new Error(`External entity "${location}" contains XML declaration in invalid position`);
        }

        // Check for excessive non-printable characters that might indicate binary content
        let nonPrintableCount = 0;
        const checkLength = Math.min(textContent.length, 1000);
        for (let i = 0; i < checkLength; i++) {
            const code: number = textContent.codePointAt(i) ?? -1;
            // Allow common XML characters: tab(9), newline(10), carriage return(13), and printable ASCII
            // Also allow Unicode characters above 127
            if (code < 9 || (code > 13 && code < 32) || code === 127) {
                nonPrintableCount++;
            }
        }

        // If more than 20% of characters are non-printable control characters, likely binary
        // (increased threshold and only checked control chars, not Unicode)
        if (checkLength > 0 && (nonPrintableCount / checkLength) > 0.2) {
            throw new Error(`External entity "${location}" appears to contain binary data and cannot be used as XML text`);
        }
    }

    private removeTextDeclaration(content: string): string {
        let index: number = 0;
        while (index < content.length && XMLUtils.isXmlSpace(content.charAt(index))) {
            index++;
        }
        if (index >= content.length) {
            return content;
        }
        if (!content.startsWith('<?xml', index)) {
            return content;
        }
        const nextChar: string = content.charAt(index + 5);
        if (!XMLUtils.isXmlSpace(nextChar)) {
            return content;
        }

        let pointer: number = index + 5;
        let quoteChar: string | null = null;
        while (pointer < content.length) {
            const current: string = content.charAt(pointer);
            if (quoteChar) {
                if (current === quoteChar) {
                    quoteChar = null;
                }
                pointer++;
                continue;
            }
            if (current === '"' || current === '\'') {
                quoteChar = current;
                pointer++;
                continue;
            }
            if (pointer + 1 < content.length && content.charAt(pointer) === '?' && content.charAt(pointer + 1) === '>') {
                const prefix: string = content.substring(0, index);
                const suffix: string = content.substring(pointer + 2);
                return prefix + suffix;
            }
            pointer++;
        }
        return content;
    }

    expandParameterEntities(text: string): string {
        let result: string = text;
        const maxIterations: number = 50;
        let iteration: number = 0;

        while (iteration < maxIterations) {
            const entityMatches = this.findParameterEntityReferences(result);
            if (entityMatches.length === 0) {
                break;
            }

            let changed: boolean = false;

            for (const match of entityMatches) {
                const entity = this.grammar.getParameterEntity(match.name);
                if (!entity) {
                    continue;
                }
                const entityValue: string = entity.getValue();

                let searchIndex: number = 0;
                while (true) {
                    const referenceIndex: number = result.indexOf(match.reference, searchIndex);
                    if (referenceIndex === -1) {
                        break;
                    }

                    const beforeChar: string = referenceIndex > 0 ? result.charAt(referenceIndex - 1) : '';
                    const afterIndex: number = referenceIndex + match.reference.length;
                    const afterChar: string = afterIndex < result.length ? result.charAt(afterIndex) : '';
                    const originalBeforeChar: string = beforeChar;
                    const originalAfterChar: string = afterChar;

                    let replacement: string = entityValue;
                    if (this.needsSeparatorBefore(beforeChar, replacement, originalBeforeChar)) {
                        replacement = ' ' + replacement;
                    }
                    if (this.needsSeparatorAfter(afterChar, replacement, originalAfterChar)) {
                        replacement = replacement + ' ';
                    }

                    result = result.substring(0, referenceIndex) + replacement + result.substring(afterIndex);
                    searchIndex = referenceIndex + replacement.length;
                    changed = true;
                }
            }

            if (!changed) {
                break;
            }

            iteration++;
        }

        if (iteration >= maxIterations) {
            console.warn(`Parameter entity expansion reached maximum iterations (${maxIterations}), some entities may not be fully expanded`);
        }

        return result;
    }

    private containsParameterEntityReference(text: string): boolean {
        for (let index = 0; index < text.length; index++) {
            if (text.charAt(index) !== '%') {
                continue;
            }
            const endIndex: number | null = this.readParameterEntityReference(text, index);
            if (endIndex !== null) {
                return true;
            }
        }
        return false;
    }

    private validateAttributeDefaultEntities(list: AttListDecl): void {
        const location: string = this.currentFile || this.baseDirectory || 'DTD';
        const where: string = location ? ` in ${location}` : '';
        list.getAttributes().forEach((decl: AttDecl, attributeName: string) => {
            const defaultValue: string = decl.getDefaultValue();
            if (!defaultValue) {
                return;
            }

            let index: number = 0;
            while (index < defaultValue.length) {
                const ampIndex: number = defaultValue.indexOf('&', index);
                if (ampIndex === -1) {
                    break;
                }
                const semiIndex: number = defaultValue.indexOf(';', ampIndex + 1);
                if (semiIndex === -1) {
                    throw new Error(`Invalid ATTLIST declaration${where}: unterminated entity reference in default value of attribute "${attributeName}"`);
                }

                const entityName: string = defaultValue.substring(ampIndex + 1, semiIndex);
                if (entityName.length === 0) {
                    throw new Error(`Invalid ATTLIST declaration${where}: empty entity reference in default value of attribute "${attributeName}"`);
                }
                if (entityName.startsWith('#')) {
                    index = semiIndex + 1;
                    continue;
                }
                if (this.isPredefinedGeneralEntity(entityName)) {
                    index = semiIndex + 1;
                    continue;
                }
                if (!this.grammar.getEntity(entityName)) {
                    throw new Error(`Invalid ATTLIST declaration${where}: entity "${entityName}" must be declared before it is referenced in default value of attribute "${attributeName}"`);
                }
                index = semiIndex + 1;
            }
        });
    }

    private isPredefinedGeneralEntity(name: string): boolean {
        switch (name) {
            case 'lt':
            case 'gt':
            case 'amp':
            case 'apos':
            case 'quot':
                return true;
            default:
                return false;
        }
    }

    private requireWhitespaceAfterKeyword(declaration: string, keyword: string, context: string): void {
        if (declaration.length <= keyword.length) {
            return;
        }
        const followingChar: string = declaration.charAt(keyword.length);
        if (followingChar === '%') {
            const entityReferenceEnd: number | null = this.readParameterEntityReference(declaration, keyword.length);
            if (entityReferenceEnd !== null) {
                return;
            }
        }
        if (!XMLUtils.isXmlSpace(followingChar)) {
            const location: string = this.currentFile || this.baseDirectory || 'DTD';
            const where: string = location ? ` in ${location}` : '';
            throw new Error(`Invalid ${context}${where}: whitespace is required after the keyword`);
        }
    }

    private hasParameterEntityReferenceOutsideLiterals(text: string): boolean {
        let inSingleQuote: boolean = false;
        let inDoubleQuote: boolean = false;
        let index: number = 0;

        while (index < text.length) {
            const char: string = text.charAt(index);
            if (!inDoubleQuote && char === "'") {
                inSingleQuote = !inSingleQuote;
                index++;
                continue;
            }
            if (!inSingleQuote && char === '"') {
                inDoubleQuote = !inDoubleQuote;
                index++;
                continue;
            }
            if (inSingleQuote || inDoubleQuote) {
                index++;
                continue;
            }

            if (char === '<' && text.startsWith('<!--', index)) {
                const end: number = text.indexOf('-->', index + 4);
                if (end === -1) {
                    return false;
                }
                index = end + '-->'.length;
                continue;
            }

            if (char === '%') {
                const endIndex: number | null = this.readParameterEntityReference(text, index);
                if (endIndex !== null) {
                    return true;
                }
            }

            index++;
        }
        return false;
    }

    private readParameterEntityReference(text: string, percentIndex: number): number | null {
        const nameStartIndex: number = percentIndex + 1;
        if (nameStartIndex >= text.length) {
            return null;
        }
        const nameStartChar: string = text.charAt(nameStartIndex);
        if (!XMLUtils.isNameStartChar(nameStartChar)) {
            return null;
        }
        let nameEndIndex: number = nameStartIndex + 1;
        while (nameEndIndex < text.length && XMLUtils.isNameChar(text.charAt(nameEndIndex))) {
            nameEndIndex++;
        }
        if (nameEndIndex < text.length && text.charAt(nameEndIndex) === ';') {
            return nameEndIndex;
        }
        return null;
    }

    private needsSeparatorBefore(beforeChar: string, replacement: string, originalBeforeChar: string = ''): boolean {
        if (replacement.length === 0) {
            return false;
        }
        if (beforeChar === '') {
            return false;
        }
        if (beforeChar === '%') {
            return false;
        }
        if (originalBeforeChar === ';' || originalBeforeChar === '%') {
            return false;
        }
        if (XMLUtils.isXmlSpace(beforeChar)) {
            return false;
        }
        if (this.isMarkupDelimiter(beforeChar)) {
            return false;
        }

        const firstChar: string = replacement.charAt(0);
        if (firstChar === '%') {
            return false;
        }
        if (XMLUtils.isXmlSpace(firstChar)) {
            return false;
        }
        if (firstChar === '"' || firstChar === "'") {
            return true;
        }
        if (this.isMarkupDelimiter(firstChar)) {
            return false;
        }
        return true;
    }

    private needsSeparatorAfter(afterChar: string, replacement: string, originalAfterChar: string = ''): boolean {
        if (replacement.length === 0) {
            return false;
        }
        if (afterChar === '') {
            return false;
        }
        if (afterChar === '%') {
            return false;
        }
        if (originalAfterChar === '%' || originalAfterChar === ';') {
            return false;
        }
        if (XMLUtils.isXmlSpace(afterChar)) {
            return false;
        }
        if (this.isMarkupDelimiter(afterChar)) {
            return false;
        }

        const lastChar: string = replacement.charAt(replacement.length - 1);
        if (lastChar === '%') {
            return false;
        }
        if (XMLUtils.isXmlSpace(lastChar)) {
            return false;
        }
        if (this.isMarkupDelimiter(lastChar)) {
            return false;
        }
        return true;
    }

    private isMarkupDelimiter(char: string): boolean {
        if (char === '') {
            return false;
        }
        return ['<', '>', '[', ']', '(', ')', '"', '\'', '|', '?', '*', '+', '=', ',', ';', ':', '/'].includes(char);
    }

    private findParameterEntityReferences(text: string): Array<{ reference: string, name: string }> {
        const references: Array<{ reference: string, name: string }> = [];
        let inQuotes: boolean = false;
        let quoteChar: string = '';
        let index: number = 0;

        while (index < text.length) {
            const char: string = text.charAt(index);
            if (inQuotes) {
                if (char === quoteChar) {
                    inQuotes = false;
                    quoteChar = '';
                }
                index++;
                continue;
            }
            if (char === '"' || char === "'") {
                inQuotes = true;
                quoteChar = char;
                index++;
                continue;
            }
            if (char === '%') {
                let end: number = text.indexOf(';', index + 1);
                if (end === -1) {
                    break;
                }
                const rawName: string = text.substring(index + 1, end).trim();
                if (rawName.length > 0 && XMLUtils.isValidXMLName(rawName)) {
                    references.push({ reference: `%${rawName};`, name: rawName });
                }
                index = end + 1;
                continue;
            }
            index++;
        }

        return references;
    }

    getGrammar(): DTDGrammar {
        return this.grammar;
    }
}