/*******************************************************************************
 * Copyright (c) 2023-2026 Maxprograms.
 *
 * This program and the accompanying materials
 * are made available under the terms of the Eclipse   License 1.0
 * which accompanies this distribution, and is available at
 * https://www.eclipse.org/org/documents/epl-v10.html
 *
 * Contributors:
 *     Maxprograms - initial API and implementation
 *******************************************************************************/

import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { Catalog } from "./Catalog.js";
import { Constants } from "./Constants.js";
import { ContentHandler } from "./ContentHandler.js";
import { FileReader } from "./FileReader.js";
import { NeedMoreDataError } from "./NeedMoreDataError.js";
import { RelaxNGParser } from "./RelaxNGParser.js";
import { StreamReader } from "./StreamReader.js";
import { StringReader } from "./StringReader.js";
import { XMLAttribute } from "./XMLAttribute.js";
import { XMLSchemaParser, type AttributeDefault } from "./XMLSchemaParser.js";
import { XMLUtils } from "./XMLUtils.js";
import { AttDecl } from "./dtd/AttDecl.js";
import { DTDGrammar } from "./dtd/DTDGrammar.js";
import { DTDParser } from "./dtd/DTDParser.js";
import { FetchUrls } from "./fetchUrls.js";
import { Grammar, GrammarType, ValidationError, ValidationResult } from "./grammar/Grammar.js";
import { SchemaBuilder } from "./schema/SchemaBuilder.js";
import { SchemaGrammar } from "./schema/SchemaGrammar.js";

export interface ParseSourceOptions {
    basePath?: string;
    pseudoFileName?: string;
    virtualPath?: string;
}

export interface StreamParseOptions extends ParseSourceOptions {
    encoding?: BufferEncoding;
}

export type ParserInputSource = FileReader | StringReader | StreamReader;

type SchemaAttributeDefault = AttributeDefault;

export class SAXParser {

    private static readonly SUPPORTED_ENCODINGS: Map<string, string> = new Map<string, string>([
        ['UTF-8', 'UTF-8'],
        ['UTF-16', 'UTF-16'],
        ['UTF-16LE', 'UTF-16LE'],
        ['UTF-16BE', 'UTF-16BE']
    ]);

    private static readonly ENCODING_NAME_PATTERN: RegExp = /^[A-Za-z][A-Za-z0-9._-]*$/;

    contentHandler: ContentHandler | undefined;
    reader: ParserInputSource | undefined;
    pointer: number;
    buffer: string = '';
    elementStack: number;
    elementNameStack: string[] = [];
    childrenNames: Array<string[]> = [];
    characterRun: string;
    rootParsed: boolean;
    xmlVersion: string;
    currentFile: string | undefined;
    catalog: Catalog | undefined;
    validating: boolean = false;
    relaxNGDefaultAttributes: Map<string, Map<string, SchemaAttributeDefault>> = new Map<string, Map<string, SchemaAttributeDefault>>();
    schemaDefaultAttributes: Map<string, Map<string, SchemaAttributeDefault>> = new Map<string, Map<string, SchemaAttributeDefault>>();
    processedSchemaLocations: Set<string> = new Set<string>();
    failedSchemaLocations: Set<string> = new Set<string>();
    namespaceContextStack: Array<Map<string, string>> = [];
    processedNamespaces: Set<string> = new Set<string>();
    failedNamespaces: Set<string> = new Set<string>();
    isRelaxNG: boolean = false;
    static readonly DEFAULT_VIRTUAL_FILENAME: string = '__inmemory__.xml';
    streamingMode: boolean = false;
    sourceEnded: boolean = false;
    documentStarted: boolean = false;
    documentEnded: boolean = false;
    inCDATASection: boolean = false;
    pendingCR: boolean = false;
    readingFromFile: boolean = false;
    internalSubsetApplied: boolean = false;
    xmlDeclarationParsed: boolean = false;
    leadingContentBeforeXmlDeclaration: boolean = false;
    schemaLoadingEnabled: boolean = true;

    constructor() {
        this.characterRun = '';
        this.elementStack = 0;
        this.elementNameStack = [];
        this.childrenNames = [];
        this.pointer = 0;
        this.rootParsed = false;
        this.xmlVersion = '1.0';
        this.streamingMode = false;
        this.sourceEnded = false;
        this.documentStarted = false;
        this.documentEnded = false;
        this.inCDATASection = false;
        this.pendingCR = false;
        this.readingFromFile = false;
        this.internalSubsetApplied = false;
        this.xmlDeclarationParsed = false;
        this.leadingContentBeforeXmlDeclaration = false;
        this.schemaLoadingEnabled = true;
    }

    setContentHandler(contentHandler: ContentHandler): void {
        this.contentHandler = contentHandler;
        if (this.catalog) {
            this.contentHandler.setCatalog(this.catalog);
        }
    }

    setCatalog(catalog: Catalog): void {
        this.catalog = catalog;
        this.contentHandler?.setCatalog(catalog);
    }

    setValidating(validating: boolean): void {
        this.validating = validating;
    }

    setSchemaLoadingEnabled(enabled: boolean): void {
        this.schemaLoadingEnabled = enabled;
    }

    parseFile(path: string, encoding?: BufferEncoding): void {
        if (!this.contentHandler) {
            throw new Error('ContentHandler not set');
        }
        const normalizedPath: string = isAbsolute(path) ? path : resolve(path);
        const effectiveEncoding: BufferEncoding = encoding ?? FileReader.detectEncoding(normalizedPath);
        const reader: FileReader = new FileReader(normalizedPath, effectiveEncoding);
        this.initializeParsing(reader, normalizedPath);
        this.processSynchronous();
    }

    parseString(data: string, options?: ParseSourceOptions): void {
        if (!this.contentHandler) {
            throw new Error('ContentHandler not set');
        }
        const reader: StringReader = new StringReader(data);
        const virtualPath: string = this.resolveVirtualPath(options);
        this.initializeParsing(reader, virtualPath);
        this.processSynchronous();
    }

    parseStream(stream: Readable, options?: StreamParseOptions): Promise<void> {
        if (!this.contentHandler) {
            return Promise.reject(new Error('ContentHandler not set'));
        }
        const encoding: BufferEncoding = options?.encoding ?? 'utf8';
        const reader: StreamReader = new StreamReader(encoding);
        const virtualPath: string = this.resolveVirtualPath(options);
        this.initializeParsing(reader, virtualPath);

        return new Promise<void>((resolvePromise, rejectPromise) => {
            const cleanup = (): void => {
                stream.removeListener('data', onData);
                stream.removeListener('end', onEnd);
                stream.removeListener('error', onError);
            };

            const handleProcessing = (finalizing: boolean): void => {
                try {
                    this.processStreaming(finalizing);
                    if (this.documentEnded) {
                        cleanup();
                        this.reader?.closeFile();
                        resolvePromise();
                    } else if (finalizing) {
                        cleanup();
                        this.reader?.closeFile();
                        rejectPromise(new Error('Malformed XML document: unexpected end of stream'));
                    }
                } catch (error) {
                    if (error instanceof NeedMoreDataError) {
                        return;
                    }
                    cleanup();
                    this.reader?.closeFile();
                    rejectPromise(error as Error);
                }
            };

            const onData = (chunk: string): void => {
                reader.enqueue(chunk);
                handleProcessing(false);
            };

            const onEnd = (): void => {
                reader.markFinished();
                handleProcessing(true);
            };

            const onError = (error: Error): void => {
                cleanup();
                this.reader?.closeFile();
                rejectPromise(error);
            };

            stream.setEncoding(encoding);
            stream.on('data', onData);
            stream.once('end', onEnd);
            stream.once('error', onError);
        });
    }

    initializeParsing(reader: ParserInputSource, currentFilePath: string): void {
        this.reader = reader;
        const fallbackVirtualPath: string = resolve(process.cwd(), SAXParser.DEFAULT_VIRTUAL_FILENAME);
        this.currentFile = currentFilePath || fallbackVirtualPath;
        this.relaxNGDefaultAttributes = new Map<string, Map<string, SchemaAttributeDefault>>();
        this.schemaDefaultAttributes = new Map<string, Map<string, SchemaAttributeDefault>>();
        this.processedSchemaLocations = new Set<string>();
        this.failedSchemaLocations = new Set<string>();
        this.namespaceContextStack = [];
        this.processedNamespaces = new Set<string>();
        this.failedNamespaces = new Set<string>();
        this.isRelaxNG = false;
        this.pointer = 0;
        this.buffer = '';
        this.elementStack = 0;
        this.elementNameStack = [];
        this.childrenNames = [];
        this.characterRun = '';
        this.rootParsed = false;
        this.xmlVersion = '1.0';
        this.streamingMode = reader instanceof StreamReader;
        this.sourceEnded = false;
        this.documentStarted = false;
        this.documentEnded = false;
        this.inCDATASection = false;
        this.pendingCR = false;
        this.readingFromFile = reader instanceof FileReader;
        this.internalSubsetApplied = false;
        this.xmlDeclarationParsed = false;
        this.leadingContentBeforeXmlDeclaration = false;
        this.contentHandler?.initialize();
    }

    processSynchronous(): void {
        if (!this.reader) {
            return;
        }
        try {
            while (!this.documentEnded) {
                this.readDocument();
                if (!this.documentEnded) {
                    if (!this.tryReadMore()) {
                        break;
                    }
                }
            }
            this.ensureDocumentClosed();
        } finally {
            this.reader.closeFile();
        }
    }

    processStreaming(finalizing: boolean): void {
        if (!this.reader) {
            return;
        }
        while (true) {
            try {
                this.readDocument();
            } catch (error) {
                if (error instanceof NeedMoreDataError) {
                    return;
                }
                throw error;
            }
            if (this.documentEnded) {
                return;
            }
            let hasMoreData: boolean;
            try {
                hasMoreData = this.tryReadMore();
            } catch (error) {
                if (error instanceof NeedMoreDataError) {
                    return;
                }
                throw error;
            }
            if (!hasMoreData) {
                if (finalizing) {
                    this.ensureDocumentClosed();
                }
                return;
            }
        }
    }

    resolveVirtualPath(options?: ParseSourceOptions): string {
        if (options?.virtualPath) {
            const virtualPath: string = options.virtualPath;
            return isAbsolute(virtualPath) ? virtualPath : resolve(virtualPath);
        }
        const pseudoFileName: string = options?.pseudoFileName ?? SAXParser.DEFAULT_VIRTUAL_FILENAME;
        if (options?.basePath) {
            const normalizedBase: string = isAbsolute(options.basePath) ? options.basePath : resolve(options.basePath);
            return resolve(normalizedBase, pseudoFileName);
        }
        return resolve(process.cwd(), pseudoFileName);
    }

    tryReadMore(): boolean {
        if (!this.reader || this.sourceEnded) {
            return false;
        }
        if (this.reader instanceof StreamReader) {
            if (this.reader.dataAvailable()) {
                const chunk: string = this.reader.read();
                if (chunk === '') {
                    if (this.reader.isFinished()) {
                        this.sourceEnded = true;
                        this.flushPendingCR();
                    }
                    return false;
                }
                this.appendToBuffer(chunk);
                return true;
            }
            if (this.reader.isFinished()) {
                this.sourceEnded = true;
                this.flushPendingCR();
                return false;
            }
            throw new NeedMoreDataError();
        }
        if (this.reader.dataAvailable()) {
            const chunk: string = this.reader.read();
            if (chunk === '') {
                this.sourceEnded = true;
                this.flushPendingCR();
                return false;
            }
            this.appendToBuffer(chunk);
            return true;
        }
        const chunk: string = this.reader.read();
        if (chunk === '') {
            this.sourceEnded = true;
            this.flushPendingCR();
            return false;
        }
        this.appendToBuffer(chunk);
        return true;
    }

    private appendToBuffer(chunk: string): void {
        if (chunk.length === 0) {
            return;
        }
        let text: string = chunk;
        if (this.pendingCR) {
            text = '\r' + text;
            this.pendingCR = false;
        }
        if (text.endsWith('\r')) {
            this.pendingCR = true;
            text = text.substring(0, text.length - 1);
        }
        text = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
        this.buffer += text;
    }

    private flushPendingCR(): void {
        if (this.pendingCR) {
            this.buffer += '\n';
            this.pendingCR = false;
        }
    }

    ensureDocumentClosed(): void {
        if (this.documentEnded) {
            return;
        }
        if (!this.sourceEnded) {
            if (this.streamingMode) {
                throw new NeedMoreDataError();
            }
            throw new Error('Malformed XML document: unexpected end of input');
        }
        if (this.elementStack !== 0) {
            throw new Error('Malformed XML document: unclosed elements');
        }
        this.cleanCharacterRun();
        if (!this.rootParsed) {
            throw new Error('Malformed XML document: missing document element');
        }
        if (this.rootParsed && !this.documentEnded) {
            this.contentHandler?.endDocument();
            this.documentEnded = true;
        }
    }

    ensureLookahead(minRemaining: number): void {
        if (this.buffer.length - this.pointer >= minRemaining) {
            return;
        }
        while (this.buffer.length - this.pointer < minRemaining) {
            if (!this.tryReadMore()) {
                break;
            }
        }
        if (this.buffer.length - this.pointer < minRemaining) {
            if (this.sourceEnded) {
                return;
            }
            if (this.streamingMode) {
                throw new NeedMoreDataError();
            }
        }
    }

    readDocument(): void {
        if (!this.reader) {
            return;
        }
        if (!this.documentStarted) {
            this.contentHandler?.startDocument();
            this.documentStarted = true;
        }
        while (true) {
            if (this.pointer >= this.buffer.length) {
                if (!this.tryReadMore()) {
                    break;
                }
                continue;
            }
            if (this.inCDATASection) {
                const endIndex: number = this.buffer.indexOf(']]>', this.pointer);
                if (endIndex === -1) {
                    const chunk: string = this.buffer.substring(this.pointer);
                    XMLUtils.ensureValidXmlCharacters(this.xmlVersion, chunk, 'CDATA section');
                    this.characterRun += chunk;
                    this.pointer = this.buffer.length;
                    if (!this.tryReadMore()) {
                        if (this.sourceEnded) {
                            throw new Error('Malformed XML document: unterminated CDATA section');
                        }
                        if (this.streamingMode) {
                            throw new NeedMoreDataError();
                        }
                    }
                    continue;
                }
                const chunk: string = this.buffer.substring(this.pointer, endIndex);
                XMLUtils.ensureValidXmlCharacters(this.xmlVersion, chunk, 'CDATA section');
                this.characterRun += chunk;
                this.pointer = endIndex;
                this.endCDATA();
                continue;
            }
            if (this.lookingAt('<?xml ') || this.lookingAt('<?xml\t') || this.lookingAt('<?xml\r') || this.lookingAt('<?xml\n')) {
                if (this.rootParsed && this.elementStack > 0) {
                    throw new Error('Malformed XML declaration: declaration cannot appear inside the document element');
                }
                this.parseXMLDeclaration();
                continue;
            }
            if (this.lookingAt('<!DOCTYPE')) {
                this.parseDoctype();
                continue;
            }
            if (this.lookingAt('<!--')) {
                this.parseComment();
                continue;
            }
            if (this.lookingAt('<?')) {
                this.parseProcessingInstruction();
                continue;
            }
            if (this.lookingAt('</')) {
                this.endElement();
                continue;
            }
            if (this.lookingAt('<![CDATA[')) {
                this.startCDATA();
                continue;
            }
            if (this.lookingAt(']]>')) {
                if (!this.inCDATASection) {
                    throw new Error('Malformed XML document: "]]>" cannot appear in character data');
                }
                this.endCDATA();
                continue;
            }
            if (this.lookingAt('&')) {
                if (!this.rootParsed || this.elementStack === 0) {
                    throw new Error('Malformed XML document: text found outside the document element');
                }
                this.parseEntityReference();
                continue;
            }
            if (this.lookingAt('<')) {
                if (this.rootParsed && this.elementStack === 0) {
                    throw new Error('Malformed XML document: multiple root elements');
                }
                this.startElement();
                continue;
            }
            const codePoint: number = this.buffer.codePointAt(this.pointer)!;
            XMLUtils.ensureValidXmlCodePoint(this.xmlVersion, codePoint, 'character data');
            const char: string = String.fromCodePoint(codePoint);
            if (!this.rootParsed && !XMLUtils.isXmlSpace(char)) {
                throw new Error('Malformed XML document: text found in prolog');
            }
            if (!this.xmlDeclarationParsed && !this.rootParsed && XMLUtils.isXmlSpace(char)) {
                this.leadingContentBeforeXmlDeclaration = true;
            }
            if (this.rootParsed && this.elementStack === 0 && !XMLUtils.isXmlSpace(char)) {
                throw new Error('Malformed XML document: text found after root element');
            }
            this.characterRun += char;
            this.pointer += char.length;
            if (!this.inCDATASection && this.characterRun.endsWith(']]>')) {
                throw new Error('Malformed XML document: "]]>" cannot appear in character data');
            }
        }
        if (this.sourceEnded) {
            this.ensureDocumentClosed();
        } else if (this.streamingMode) {
            throw new NeedMoreDataError();
        }
    }

    parseEntityReference() {
        this.cleanCharacterRun();
        this.pointer++; // skip '&'
        let name: string = '';
        while (true) {
            this.ensureLookahead(1);
            if (this.pointer >= this.buffer.length) {
                if (this.sourceEnded) {
                    throw new Error('Malformed XML document: unterminated entity reference');
                }
                if (this.streamingMode) {
                    throw new NeedMoreDataError();
                }
            }
            if (this.buffer.charAt(this.pointer) === ';') {
                break;
            }
            name += this.buffer.charAt(this.pointer++);
        }
        const grammar: Grammar | undefined = this.contentHandler?.getGrammar();
        const resolvedEntity: string | undefined = grammar?.resolveEntity(name);

        if (name === 'lt') {
            this.contentHandler?.characters('<');
        } else if (name === 'gt') {
            this.contentHandler?.characters('>');
        } else if (name === 'amp') {
            this.contentHandler?.characters('&');
        } else if (name === 'apos') {
            this.contentHandler?.characters('\'');
        } else if (name === 'quot') {
            this.contentHandler?.characters('"');
        } else if (name.startsWith('#x')) {
            const codePoint: number = Number.parseInt(name.substring(2), 16);
            XMLUtils.ensureValidXmlCodePoint(this.xmlVersion, codePoint, `character reference &#x${name.substring(2)};`);
            const char: string = String.fromCodePoint(codePoint);
            this.contentHandler?.characters(char);
        } else if (name.startsWith('#')) {
            const codePoint: number = Number.parseInt(name.substring(1), 10);
            XMLUtils.ensureValidXmlCodePoint(this.xmlVersion, codePoint, `character reference &#${name.substring(1)};`);
            const char: string = String.fromCodePoint(codePoint);
            this.contentHandler?.characters(char);
        } else if (resolvedEntity !== undefined) {
            this.pointer++; // skip ';'
            const remaining: string = this.buffer.substring(this.pointer);
            const expandedReplacement: string = this.expandEntityReplacement(resolvedEntity, grammar, 0, new Set<string>([name]));
            XMLUtils.ensureValidXmlCharacters(this.xmlVersion, expandedReplacement, `expanded entity &${name};`);
            this.buffer = expandedReplacement + remaining;
            this.pointer = 0;
            return;
        } else {
            throw new Error(`Malformed XML document: undefined general entity &${name};`);
        }
        this.pointer++; // skip ';'
        this.buffer = this.buffer.substring(this.pointer);
        this.pointer = 0;
    }

    startElement() {
        this.cleanCharacterRun();
        const tagStartPointer: number = this.pointer;
        let namespacePushed: boolean = false;
        try {
            this.pointer++; // skip '<'
            let name: string = '';
            while (true) {
                this.ensureLookahead(1);
                if (this.pointer >= this.buffer.length) {
                    if (this.sourceEnded) {
                        throw new Error('Malformed XML document: unterminated start tag');
                    }
                    if (this.streamingMode) {
                        throw new NeedMoreDataError();
                    }
                }
                if (XMLUtils.isXmlSpace(this.buffer.charAt(this.pointer)) || this.lookingAt('>') || this.lookingAt('/>')) {
                    break;
                }
                name += this.buffer.charAt(this.pointer++);
            }
            if (this.validating) {
                if (!XMLUtils.isValidXMLName(name)) {
                    throw new Error('Invalid XML name: ' + name);
                }
            }

            let rest: string = '';
            let inQuotes: boolean = false;
            let quoteChar: string = '';
            while (true) {
                this.ensureLookahead(1);
                if (this.pointer >= this.buffer.length) {
                    if (this.sourceEnded) {
                        throw new Error('Malformed XML document: unterminated start tag');
                    }
                    if (this.streamingMode) {
                        throw new NeedMoreDataError();
                    }
                }
                const currentChar: string = this.buffer.charAt(this.pointer);
                const isQuote: boolean = currentChar === '"' || currentChar === '\'';
                if (isQuote) {
                    if (inQuotes && currentChar === quoteChar) {
                        inQuotes = false;
                        quoteChar = '';
                    } else if (!inQuotes) {
                        inQuotes = true;
                        quoteChar = currentChar;
                    }
                }
                if (!inQuotes && currentChar === '>') {
                    break;
                }
                if (!inQuotes && currentChar === '/' && this.lookingAt('/>')) {
                    break;
                }
                rest += currentChar;
                this.pointer++;
            }
            rest = rest.trim();
            let attributesMap: Map<string, string> = this.parseAttributes(rest);
            const previousContext: Map<string, string> | undefined = this.namespaceContextStack.length > 0 ? this.namespaceContextStack[this.namespaceContextStack.length - 1] : undefined;
            const namespaceContext: Map<string, string> = this.buildNamespaceContext(attributesMap, previousContext);
            this.handleSchemaLocationAttributes(attributesMap, namespaceContext);
            this.namespaceContextStack.push(namespaceContext);
            namespacePushed = true;
            this.handleNamespaceDeclarations(attributesMap, namespaceContext, previousContext);
            const grammarForEntities: Grammar | undefined = this.contentHandler?.getGrammar();
            const dtdGrammarForEntities: DTDGrammar | undefined = grammarForEntities instanceof DTDGrammar ? grammarForEntities : undefined;
            attributesMap.forEach((value: string, key: string) => {
                const decoded: string = this.decodeAttributeEntities(value, dtdGrammarForEntities);
                XMLUtils.ensureValidXmlCharacters(this.xmlVersion, decoded, 'attribute value');
                if (!dtdGrammarForEntities) {
                    attributesMap.set(key, decoded);
                }
            });
            attributesMap = this.normalizeDTDAttributes(name, attributesMap);
            let attributes: Array<XMLAttribute> = [];
            attributesMap.forEach((value: string, key: string) => {
                // TODO https://www.w3.org/TR/REC-xml/#AVNormalize
                let attribute: XMLAttribute = new XMLAttribute(key, value);
                attributes.push(attribute);
            });
            attributes = this.getDefaultAttributes(name, attributes);
            attributes.forEach((attr: XMLAttribute) => {
                if (!attributesMap.has(attr.getName())) {
                    attributesMap.set(attr.getName(), attr.getValue());
                }
            });
            if (this.validating) {
                attributes.forEach((attr: XMLAttribute) => {
                    if (!XMLUtils.isValidXMLName(attr.getName())) {
                        throw new Error('Invalid XML attribute name: ' + attr.getName());
                    }
                });
                const grammar = this.contentHandler?.getGrammar();
                if (grammar) {
                    let result: ValidationResult = grammar.validateAttributes(name, attributesMap);
                    if (result.isValid === false) {
                        let errorMessages: string = '';
                        result.errors.forEach((error: ValidationError) => {
                            errorMessages += error.message + '\n';
                        });
                        throw new Error('Validation failed for element ' + name + ':\n' + errorMessages);
                    }
                }
            }

            this.ensureLookahead(1);
            let isSelfClosing: boolean = false;
            const terminatorChar: string = this.buffer.charAt(this.pointer);
            if (terminatorChar === '/') {
                this.ensureLookahead(2);
                if (this.buffer.charAt(this.pointer + 1) !== '>') {
                    throw new Error('Malformed XML document: expected "/>" to close start tag for ' + name);
                }
                isSelfClosing = true;
            } else if (terminatorChar === '>') {
                isSelfClosing = false;
            } else {
                throw new Error('Malformed XML document: unexpected character "' + terminatorChar + '" at end of start tag');
            }

            // Add this element as a child of its parent (if parent exists)
            if (this.childrenNames.length > 0) {
                let parentChildren: string[] = this.childrenNames[this.childrenNames.length - 1];
                parentChildren.push(name);
            }
            // Push a new empty array for this element's children
            this.childrenNames.push([]);

            this.contentHandler?.startElement(name, attributes);
            this.elementStack++;
            this.elementNameStack.push(name);
            if (!this.rootParsed) {
                this.rootParsed = true;
            }
            if (isSelfClosing) {
                this.cleanCharacterRun();
                let namespace: string = '';
                if (this.namespaceContextStack.length > 0) {
                    this.namespaceContextStack[this.namespaceContextStack.length - 1].forEach((uri: string, prefix: string) => {
                        if (prefix === '') {
                            namespace = uri;
                        } else if (name.startsWith(prefix + ':')) {
                            namespace = uri;
                        }
                    });
                }
                this.validateElement(name, namespace);
                this.contentHandler?.endElement(name);
                this.elementStack--;
                this.elementNameStack.pop();
                this.childrenNames.pop();
                if (namespacePushed && this.namespaceContextStack.length > 0) {
                    this.namespaceContextStack.pop();
                    namespacePushed = false;
                }
                this.pointer += 2; // skip '/>'
            } else {
                this.pointer++; // skip '>'
            }
            this.buffer = this.buffer.substring(this.pointer);
            this.pointer = 0;
        } catch (error) {
            if (error instanceof NeedMoreDataError) {
                this.pointer = tagStartPointer;
            }
            if (namespacePushed && this.namespaceContextStack.length > 0) {
                this.namespaceContextStack.pop();
            }
            throw error;
        }
    }

    endElement() {
        this.cleanCharacterRun();
        this.pointer += 2; // skip '</'
        let name: string = '';

        // Read tag name until whitespace or '>'
        while (true) {
            this.ensureLookahead(1);
            if (this.pointer >= this.buffer.length) {
                if (this.sourceEnded) {
                    throw new Error('Malformed XML document: unterminated end tag');
                }
                if (this.streamingMode) {
                    throw new NeedMoreDataError();
                }
            }
            if (this.lookingAt('>') || XMLUtils.isXmlSpace(this.buffer.charAt(this.pointer))) {
                break;
            }
            name += this.buffer.charAt(this.pointer);
            this.pointer++;
        }

        // Skip optional whitespace before '>'
        while (true) {
            this.ensureLookahead(1);
            if (this.pointer >= this.buffer.length) {
                if (this.sourceEnded) {
                    throw new Error('Malformed XML document: unterminated end tag');
                }
                if (this.streamingMode) {
                    throw new NeedMoreDataError();
                }
            }
            if (!XMLUtils.isXmlSpace(this.buffer.charAt(this.pointer))) {
                break;
            }
            this.pointer++;
        }

        // Expect '>'
        if (!this.lookingAt('>')) {
            throw new Error('Well-formedness error: expected ">" in end tag "</' + name + '"');
        }

        // Well-formedness check: mismatched element tags
        if (this.elementNameStack.length === 0) {
            throw new Error('Mismatched element tags: found closing tag "' + name + '" but no elements are open');
        }
        const expectedName: string | undefined = this.elementNameStack.pop();
        if (name !== expectedName) {
            throw new Error('Mismatched element tags: expected closing tag for "' + expectedName + '" but found "' + name + '"');
        }
        // Validate element content when validating mode is enabled  
        if (this.validating && !this.isRelaxNG) {
            let namespace: string = '';
            if (this.namespaceContextStack.length > 0) {
                this.namespaceContextStack[this.namespaceContextStack.length - 1].forEach((uri: string, prefix: string) => {
                    if (prefix === '') {
                        namespace = uri;
                    } else if (name.startsWith(prefix + ':')) {
                        namespace = uri;
                    }
                });
            }
            this.validateElement(name, namespace);
        }
        const grammar: Grammar | undefined = this.contentHandler?.getGrammar();
        if (grammar !== undefined && grammar.getGrammarType() === GrammarType.XML_SCHEMA) {
            const currentText: string = this.contentHandler ? this.contentHandler.getCurrentText() : '';
            if (currentText.trim() === '') {
                const defaultText: string | undefined = grammar.getElementTextDefault(name);
                if (defaultText !== undefined) {
                    this.contentHandler?.characters(defaultText);
                }
            }
        }
        this.contentHandler?.endElement(name);
        this.elementStack--;
        if (this.childrenNames.length > 0) {
            this.childrenNames.pop();
        }
        if (this.namespaceContextStack.length > 0) {
            this.namespaceContextStack.pop();
        }
        this.pointer++; // skip '>'
        this.buffer = this.buffer.substring(this.pointer);
        this.pointer = 0;
    }

    validateElement(name: string, namespace: string): void {
        const grammar: Grammar | undefined = this.contentHandler?.getGrammar();
        if (grammar && this.validating) {
            const text: string = this.contentHandler ? this.contentHandler.getCurrentText() : '';
            const actualChildrenNames: string[] = this.childrenNames.length > 0 ? this.childrenNames[this.childrenNames.length - 1] : [];
            const elementValidationResult = grammar.validateElement(name, namespace, actualChildrenNames, text);
            if (!elementValidationResult.isValid) {
                const errorMessages: string = elementValidationResult.errors.map(e => e.message).join('; ');
                throw new Error('Element validation failed for element "' + name + '": ' + errorMessages);
            }
        }
    }

    getDefaultAttributes(elementName: string, attributes: Array<XMLAttribute>): Array<XMLAttribute> {
        const grammar: Grammar | undefined = this.contentHandler?.getGrammar();
        const namespaceContext: Map<string, string> = this.namespaceContextStack.length > 0 ? this.namespaceContextStack[this.namespaceContextStack.length - 1] : new Map<string, string>();
        const existingAttributeNames: Set<string> = new Set<string>();
        const existingAttributeKeys: Set<string> = new Set<string>();
        attributes.forEach((attr: XMLAttribute) => {
            const attributeName: string = attr.getName();
            existingAttributeNames.add(attributeName);
            const attributeParts: { prefix?: string; localName: string } = this.splitQualifiedName(attributeName);
            let attributeNamespaceUri: string | undefined = undefined;
            if (attributeParts.prefix) {
                attributeNamespaceUri = namespaceContext.get(attributeParts.prefix);
            }
            const attributeKey: string = this.buildSchemaAttributeKey(attributeParts.localName, attributeNamespaceUri);
            existingAttributeKeys.add(attributeKey);
        });

        if (grammar) {
            const grammarDefaults: Map<string, string> | undefined = grammar.getDefaultAttributes(elementName);
            if (grammarDefaults) {
                const dtdGrammar: DTDGrammar | undefined = grammar instanceof DTDGrammar ? grammar : undefined;
                const declarations: Map<string, AttDecl> | undefined = dtdGrammar?.getElementAttributesMap(elementName);
                grammarDefaults.forEach((value: string, key: string) => {
                    const grammarParts: { prefix?: string; localName: string } = this.splitQualifiedName(key);
                    const attributeKey: string = this.buildSchemaAttributeKey(grammarParts.localName);
                    if (existingAttributeKeys.has(attributeKey) || existingAttributeNames.has(key)) {
                        return;
                    }
                    let normalizedValue: string;
                    if (dtdGrammar) {
                        const expanded: string = this.decodeAttributeEntities(value, dtdGrammar);
                        const decl: AttDecl | undefined = declarations?.get(key);
                        normalizedValue = this.normalizeAttributeValue(value, expanded, decl);
                    } else {
                        normalizedValue = this.normalizeAttributeValue(value, value);
                    }
                    attributes.push(new XMLAttribute(key, normalizedValue));
                    existingAttributeNames.add(key);
                    existingAttributeKeys.add(attributeKey);
                });
            }
        }

        const nameParts: { prefix?: string; localName: string } = this.splitQualifiedName(elementName);
        const namespaceUri: string | undefined = this.getNamespaceUriForElement(elementName);
        if (namespaceUri) {
            const namespaceKey: string = namespaceUri + "|" + nameParts.localName;
            this.appendSchemaDefaultsForElement(this.schemaDefaultAttributes.get(namespaceKey), attributes, existingAttributeNames, existingAttributeKeys, namespaceUri, nameParts, namespaceContext);
        }
        this.appendSchemaDefaultsForElement(this.schemaDefaultAttributes.get(nameParts.localName), attributes, existingAttributeNames, existingAttributeKeys, namespaceUri, nameParts, namespaceContext);
        if (nameParts.localName !== elementName) {
            this.appendSchemaDefaultsForElement(this.schemaDefaultAttributes.get(elementName), attributes, existingAttributeNames, existingAttributeKeys, namespaceUri, nameParts, namespaceContext);
        }
        if (this.isRelaxNG) {
            if (namespaceUri) {
                const namespaceRelaxKey: string = namespaceUri + "|" + nameParts.localName;
                this.appendSchemaDefaultsForElement(this.relaxNGDefaultAttributes.get(namespaceRelaxKey), attributes, existingAttributeNames, existingAttributeKeys, namespaceUri, nameParts, namespaceContext);
            }
            this.appendSchemaDefaultsForElement(this.relaxNGDefaultAttributes.get(nameParts.localName), attributes, existingAttributeNames, existingAttributeKeys, namespaceUri, nameParts, namespaceContext);
            if (nameParts.localName !== elementName) {
                this.appendSchemaDefaultsForElement(this.relaxNGDefaultAttributes.get(elementName), attributes, existingAttributeNames, existingAttributeKeys, namespaceUri, nameParts, namespaceContext);
            }
        }
        return attributes;
    }

    private appendSchemaDefaultsForElement(defaults: Map<string, SchemaAttributeDefault> | undefined, attributes: Array<XMLAttribute>, existingAttributeNames: Set<string>, existingAttributeKeys: Set<string>, namespaceUri: string | undefined, elementNameParts: { prefix?: string; localName: string }, namespaceContext: Map<string, string>): void {
        if (!defaults) {
            return;
        }
        defaults.forEach((info: SchemaAttributeDefault) => {
            const attributeKey: string = this.buildSchemaAttributeKey(info.localName, info.namespace);
            if (existingAttributeKeys.has(attributeKey)) {
                return;
            }
            const attributeName: string = this.resolveSchemaAttributeQualifiedName(info, namespaceUri, elementNameParts, namespaceContext);
            if (existingAttributeNames.has(attributeName)) {
                return;
            }
            const normalizedValue: string = this.normalizeAttributeValue(info.value, info.value);
            attributes.push(new XMLAttribute(attributeName, normalizedValue));
            existingAttributeNames.add(attributeName);
            existingAttributeKeys.add(attributeKey);
        });
    }

    private resolveSchemaAttributeQualifiedName(info: SchemaAttributeDefault, namespaceUri: string | undefined, elementNameParts: { prefix?: string; localName: string }, namespaceContext: Map<string, string>): string {
        const lexicalName: string = info.lexicalName;
        const attributeNamespace: string | undefined = info.namespace;
        const parts: { prefix?: string; localName: string } = this.splitQualifiedName(lexicalName);
        if (parts.prefix) {
            const mappedNamespace: string | undefined = namespaceContext.get(parts.prefix);
            if (!attributeNamespace && mappedNamespace) {
                return lexicalName;
            }
            if (attributeNamespace && mappedNamespace === attributeNamespace) {
                return lexicalName;
            }
            if (attributeNamespace) {
                const prefix: string | undefined = this.findNamespacePrefix(attributeNamespace, namespaceContext);
                if (prefix) {
                    return prefix + ":" + info.localName;
                }
            }
            return info.localName;
        }
        if (attributeNamespace) {
            const prefix: string | undefined = this.findNamespacePrefix(attributeNamespace, namespaceContext);
            if (prefix) {
                return prefix + ":" + info.localName;
            }
            if (namespaceUri && attributeNamespace === namespaceUri && elementNameParts.prefix) {
                return elementNameParts.prefix + ":" + info.localName;
            }
        }
        return info.lexicalName;
    }

    private findNamespacePrefix(namespaceUri: string, context: Map<string, string>): string | undefined {
        for (const entry of context.entries()) {
            const prefix: string = entry[0];
            const uri: string = entry[1];
            if (uri === namespaceUri && prefix !== '') {
                return prefix;
            }
        }
        return undefined;
    }

    private buildSchemaAttributeKey(localName: string, namespace?: string): string {
        if (namespace) {
            return namespace + "|" + localName;
        }
        return localName;
    }

    private buildNamespaceContext(attributes: Map<string, string>, previousContext?: Map<string, string>): Map<string, string> {
        const context: Map<string, string> = previousContext ? new Map<string, string>(previousContext) : new Map<string, string>();
        attributes.forEach((value: string, key: string) => {
            if (key === 'xmlns') {
                context.set('', value);
            } else if (key.startsWith('xmlns:') && key.length > 6) {
                const prefix: string = key.substring(6);
                context.set(prefix, value);
            }
        });
        if (!context.has('xml')) {
            context.set('xml', 'http://www.w3.org/XML/1998/namespace');
        }
        return context;
    }

    protected handleNamespaceDeclarations(attributes: Map<string, string>, namespaceContext: Map<string, string>, previousContext?: Map<string, string>): void {
        attributes.forEach((value: string, key: string) => {
            if (key === 'xmlns') {
                const trimmed: string = value.trim();
                const previousValue: string | undefined = previousContext ? previousContext.get('') : undefined;
                if (trimmed !== '' && trimmed !== previousValue) {
                    this.tryLoadSchemaForNamespace(trimmed);
                }
                this.propagateNamespaceToGrammar('', trimmed);
                return;
            }
            if (!key.startsWith('xmlns:') || key.length <= 6) {
                return;
            }
            const prefix: string = key.substring(6);
            const trimmed: string = value.trim();
            const previousValue: string | undefined = previousContext ? previousContext.get(prefix) : undefined;
            if (trimmed !== '' && trimmed !== previousValue) {
                this.tryLoadSchemaForNamespace(trimmed);
            }
            this.propagateNamespaceToGrammar(prefix, trimmed);
        });
        // If no new declaration appears on the current element, ensure the default namespace is considered.
        if (!previousContext && namespaceContext.has('')) {
            const defaultNamespace: string | undefined = namespaceContext.get('');
            if (defaultNamespace) {
                this.tryLoadSchemaForNamespace(defaultNamespace);
                this.propagateNamespaceToGrammar('', defaultNamespace);
            }
        }
    }

    private propagateNamespaceToGrammar(prefix: string, uri: string): void {
        if (!uri) {
            return;
        }
        const grammar: Grammar | undefined = this.contentHandler?.getGrammar();
        if (grammar instanceof SchemaGrammar) {
            grammar.addNamespaceDeclaration(prefix, uri);
        }
    }

    private handleSchemaLocationAttributes(attributes: Map<string, string>, namespaceContext: Map<string, string>): void {
        const schemaInstancePrefixes: Set<string> = new Set<string>();
        namespaceContext.forEach((uri: string, prefix: string) => {
            if (uri === Constants.XML_SCHEMA_INSTANCE_NS_URI) {
                schemaInstancePrefixes.add(prefix);
            }
        });
        if (schemaInstancePrefixes.size === 0) {
            return;
        }
        attributes.forEach((value: string, key: string) => {
            if (key === 'xmlns' || key.startsWith('xmlns:')) {
                return;
            }
            const { prefix, localName } = this.splitQualifiedName(key);
            if (!prefix || !schemaInstancePrefixes.has(prefix)) {
                return;
            }
            if (localName === 'schemaLocation') {
                const tokens: string[] = value.trim().split(/\s+/).filter((token: string) => token.length > 0);
                if (tokens.length < 2) {
                    return;
                }
                for (let index: number = 0; index + 1 < tokens.length; index += 2) {
                    const namespaceUri: string = tokens[index];
                    const location: string = tokens[index + 1];
                    this.processSchemaReference(namespaceUri, location);
                }
            } else if (localName === 'noNamespaceSchemaLocation') {
                const location: string = value.trim();
                if (location !== '') {
                    this.processSchemaReference('', location);
                }
            }
        });
    }

    protected tryLoadSchemaForNamespace(namespaceUri: string): void {
        if (!this.schemaLoadingEnabled) {
            return;
        }
        if (namespaceUri === '') {
            return;
        }
        if (XMLSchemaParser.shouldIgnoreNamespace(namespaceUri)) {
            this.processedNamespaces.add(namespaceUri);
            return;
        }
        if (this.processedNamespaces.has(namespaceUri) || this.failedNamespaces.has(namespaceUri)) {
            return;
        }
        if (!this.catalog) {
            return;
        }
        const candidates: Array<string | undefined> = [
            this.catalog.matchURI(namespaceUri),
            this.catalog.matchSystem(namespaceUri)
        ];
        for (let index: number = 0; index < candidates.length; index++) {
            const candidate: string | undefined = candidates[index];
            if (!candidate) {
                continue;
            }
            const normalized: string = candidate.startsWith('file://') ? fileURLToPath(candidate) : candidate;
            if (!existsSync(normalized)) {
                continue;
            }
            if (this.loadSchemaDefaults(normalized, namespaceUri)) {
                this.processedNamespaces.add(namespaceUri);
                return;
            }
        }
        this.failedNamespaces.add(namespaceUri);
    }

    private processSchemaReference(namespaceUri: string, location: string): void {
        if (!this.schemaLoadingEnabled) {
            return;
        }
        if (location === '') {
            return;
        }
        if (this.processedSchemaLocations.has(location) || this.failedSchemaLocations.has(location)) {
            return;
        }
        const resolvedPath: string | undefined = this.resolveSchemaLocation(namespaceUri, location);
        if (!resolvedPath) {
            this.failedSchemaLocations.add(location);
            return;
        }
        const schemaLoaded: boolean = this.loadSchemaDefaults(resolvedPath, location);
        if (resolvedPath.startsWith(tmpdir())) {
            try { unlinkSync(resolvedPath); } catch (e: unknown) { /* ignore */ }
        }
        if (!schemaLoaded) {
            this.failedSchemaLocations.add(location);
        }
    }

    protected loadSchemaDefaults(resolvedPath: string, identifier: string): boolean {
        if (this.processedSchemaLocations.has(resolvedPath)) {
            this.processedSchemaLocations.add(identifier);
            return true;
        }
        try {
            const parser: XMLSchemaParser = XMLSchemaParser.getInstance(this.catalog);
            const rawDefaults: Map<string, Map<string, SchemaAttributeDefault>> = parser.collectDefaultAttributes(resolvedPath);
            const convertedDefaults: Map<string, Map<string, SchemaAttributeDefault>> = new Map<string, Map<string, SchemaAttributeDefault>>();
            rawDefaults.forEach((attributeMap: Map<string, SchemaAttributeDefault>, elementKey: string) => {
                const converted: Map<string, SchemaAttributeDefault> = new Map<string, SchemaAttributeDefault>();
                attributeMap.forEach((info: SchemaAttributeDefault, attributeKey: string) => {
                    const copy: SchemaAttributeDefault = {
                        localName: info.localName,
                        namespace: info.namespace,
                        lexicalName: info.lexicalName,
                        value: info.value
                    };
                    converted.set(attributeKey, copy);
                });
                convertedDefaults.set(elementKey, converted);
            });
            this.mergeSchemaDefaults(convertedDefaults);
            this.processedSchemaLocations.add(resolvedPath);
            this.processedSchemaLocations.add(identifier);
            if (this.validating) {
                const builder: SchemaBuilder = new SchemaBuilder(this.catalog);
                const grammar: SchemaGrammar = builder.buildGrammar(resolvedPath);
                const existing: Grammar | undefined = this.contentHandler?.getGrammar();
                if (existing instanceof SchemaGrammar) {
                    existing.mergeFrom(grammar);
                } else {
                    this.contentHandler?.setGrammar(grammar);
                }
            }
            return true;
        } catch (error) {
            if (this.validating) {
                throw error;
            }
            const message: string = error instanceof Error ? error.message : String(error);
            console.warn(`Warning: Could not load XML Schema defaults from ${resolvedPath}: ${message}`);
            return false;
        }
    }

    private resolveSchemaLocation(namespaceUri: string, location: string): string | undefined {
        let candidate: string = location;
        if (candidate.startsWith('file://')) {
            candidate = fileURLToPath(candidate);
            if (existsSync(candidate)) {
                return candidate;
            }
        }

        if (isAbsolute(location) && existsSync(location)) {
            return location;
        }

        if (!location.startsWith('http://') && !location.startsWith('https://') && !location.startsWith('urn:')) {
            if (this.currentFile) {
                const baseDir: string = dirname(this.currentFile);
                const relativeCandidate: string = resolve(baseDir, location);
                if (existsSync(relativeCandidate)) {
                    return relativeCandidate;
                }
            }
            const absoluteCandidate: string = resolve(location);
            if (existsSync(absoluteCandidate)) {
                return absoluteCandidate;
            }
        }

        if (this.catalog) {
            const catalogCandidates: Array<string | undefined> = [
                this.catalog.matchURI(location),
                this.catalog.matchSystem(location)
            ];
            if (namespaceUri) {
                catalogCandidates.push(this.catalog.matchURI(namespaceUri));
                catalogCandidates.push(this.catalog.matchSystem(namespaceUri));
            }
            for (const catalogCandidate of catalogCandidates) {
                if (!catalogCandidate) {
                    continue;
                }
                const normalized: string = catalogCandidate.startsWith('file://') ? fileURLToPath(catalogCandidate) : catalogCandidate;
                if (existsSync(normalized)) {
                    return normalized;
                }
            }
        }

        if (location.startsWith('http')) {
            return this.resolveHttp(location);
        }

        return undefined;
    }

    resolveHttp(url: string): string | undefined {
        // make sure it is a valid url first
        try {
            new URL(url);
        } catch (error) {
            return undefined;
        }
        // get the file name at the end of the url
        const urlParts: string[] = url.split('/');
        const lastPart: string = urlParts[urlParts.length - 1];
        const tempPath: string = resolve(tmpdir(), lastPart);
        let fetcher: FetchUrls = new FetchUrls();
        if (fetcher.fetch(url, tempPath)) {
            return tempPath;
        }
        if (this.validating) {
            throw new Error(fetcher.getError() || 'Failed to fetch schema from ' + url);
        }
        return undefined;
    }

    private mergeSchemaDefaults(defaults: Map<string, Map<string, SchemaAttributeDefault>>): void {
        defaults.forEach((attributeMap: Map<string, SchemaAttributeDefault>, elementName: string) => {
            if (attributeMap.size === 0) {
                return;
            }
            const target: Map<string, SchemaAttributeDefault> = this.schemaDefaultAttributes.get(elementName) ?? new Map<string, SchemaAttributeDefault>();
            attributeMap.forEach((info: SchemaAttributeDefault, attributeName: string) => {
                const copy: SchemaAttributeDefault = {
                    localName: info.localName,
                    namespace: info.namespace,
                    lexicalName: info.lexicalName,
                    value: info.value
                };
                target.set(attributeName, copy);
            });
            if (target.size > 0) {
                this.schemaDefaultAttributes.set(elementName, target);
            }
        });
    }

    private splitQualifiedName(name: string): { prefix?: string; localName: string } {
        const separatorIndex: number = name.indexOf(':');
        if (separatorIndex === -1) {
            return { localName: name };
        }
        const prefix: string = name.substring(0, separatorIndex);
        const localName: string = name.substring(separatorIndex + 1);
        return { prefix, localName };
    }

    protected getNamespaceUriForElement(elementName: string): string | undefined {
        if (this.namespaceContextStack.length === 0) {
            return undefined;
        }
        const context: Map<string, string> = this.namespaceContextStack[this.namespaceContextStack.length - 1];
        const parts: { prefix?: string; localName: string } = this.splitQualifiedName(elementName);
        if (parts.prefix === undefined) {
            return context.get('');
        }
        return context.get(parts.prefix);
    }

    cleanCharacterRun(): void {
        if (this.characterRun !== '') {
            if (this.rootParsed) {
                if (this.elementStack === 0) {
                    // document ended
                    this.contentHandler?.ignorableWhitespace(this.characterRun);
                } else {
                    // in an element
                    this.contentHandler?.characters(this.characterRun);
                }
            } else {
                // in prolog
                this.contentHandler?.ignorableWhitespace(this.characterRun);
            }
            this.characterRun = '';
        }
    }

    parseComment(): void {
        this.cleanCharacterRun();
        let comment: string = '';
        let previousWasHyphen: boolean = false;
        this.pointer += 4; // skip '<!--'
        while (true) {
            this.ensureLookahead(3);
            if (this.pointer >= this.buffer.length) {
                if (this.sourceEnded) {
                    throw new Error('Malformed XML document: unterminated comment');
                }
                if (this.streamingMode) {
                    throw new NeedMoreDataError();
                }
            }
            if (this.lookingAt('-->')) {
                break;
            }
            const codePoint: number = this.buffer.codePointAt(this.pointer)!;
            XMLUtils.ensureValidXmlCodePoint(this.xmlVersion, codePoint, 'comment');
            const char: string = String.fromCodePoint(codePoint);
            if (char === '-') {
                if (previousWasHyphen) {
                    throw new Error('Malformed XML document: comment cannot contain "--"');
                }
                previousWasHyphen = true;
            } else {
                previousWasHyphen = false;
            }
            comment += char;
            this.pointer += char.length;
        }
        if (comment.endsWith('-')) {
            throw new Error('Malformed XML document: comment cannot end with "-"');
        }
        this.buffer = this.buffer.substring(this.pointer + 3); // skip '-->'
        this.pointer = 0;
        this.contentHandler?.comment(comment);
    }

    parseProcessingInstruction(): void {
        this.cleanCharacterRun();
        let instructionText: string = '';
        let target: string = '';
        let data: string = '';
        this.pointer += 2; // skip '<?'
        while (true) {
            this.ensureLookahead(2);
            if (this.pointer >= this.buffer.length) {
                if (this.sourceEnded) {
                    throw new Error('Malformed XML document: unterminated processing instruction');
                }
                if (this.streamingMode) {
                    throw new NeedMoreDataError();
                }
            }
            if (this.lookingAt('?>')) {
                break;
            }
            const codePoint: number = this.buffer.codePointAt(this.pointer)!;
            XMLUtils.ensureValidXmlCodePoint(this.xmlVersion, codePoint, 'processing instruction');
            const char: string = String.fromCodePoint(codePoint);
            instructionText += char;
            this.pointer += char.length;
        }
        instructionText = instructionText.trim();
        if (instructionText.length === 0) {
            throw new Error('Malformed XML document: processing instruction missing target');
        }
        let i: number = 0;
        // read target
        for (; i < instructionText.length; i++) {
            let char: string = instructionText[i];
            if (XMLUtils.isXmlSpace(char)) {
                break;
            }
            target += char;
        }
        if (target.length === 0) {
            throw new Error('Malformed XML document: processing instruction missing target');
        }
        if (target.toLowerCase() === 'xml') {
            throw new Error('Malformed XML document: XML declaration must use lowercase "<?xml"');
        }
        // skip spaces
        for (; i < instructionText.length; i++) {
            let char: string = instructionText[i];
            if (!XMLUtils.isXmlSpace(char)) {
                break;
            }
        }
        // set data
        data = instructionText.substring(i);
        this.buffer = this.buffer.substring(this.pointer + 2); // skip '?>'
        this.pointer = 0;
        this.contentHandler?.processingInstruction(target, data);

        if (target === 'xml-model') {
            const attributesFromPi: Map<string, string> = this.parseAttributes(data);
            const href: string | undefined = attributesFromPi.get('href');
            const schemaType: string | undefined = attributesFromPi.get('schematypens');
            if (href) {
                const isRelaxNgSchema: boolean = schemaType ? schemaType === Constants.RELAXNG_NS_URI : href.endsWith('.rng');
                if (isRelaxNgSchema) {
                    try {
                        this.parseRelaxNG(href);
                    } catch (error) {
                        if (this.validating) {
                            throw error;
                        }
                        const message: string = error instanceof Error ? error.message : String(error);
                        console.warn(`Warning: Could not load RelaxNG defaults from ${href}: ${message}`);
                    }
                }
            }
        }
    }

    parseRelaxNG(href: string) {
        let resolvedPath: string;
        try {
            // Check if it's a file:// URL
            if (href.startsWith('file://')) {
                resolvedPath = fileURLToPath(href);
            } else if (isAbsolute(href)) {
                // Handle absolute paths
                resolvedPath = href;
            } else {
                const baseDir: string | undefined = this.currentFile ? dirname(this.currentFile) : undefined;
                resolvedPath = baseDir ? resolve(baseDir, href) : resolve(href);
            }

            if (!existsSync(resolvedPath) && this.catalog) {
                const candidates: Array<string | undefined> = [
                    this.catalog.matchSystem(href),
                    this.catalog.matchURI(href),
                    this.catalog.matchPublic(href)
                ];

                let resolvedFromCatalog: string | undefined;
                for (const candidate of candidates) {
                    if (!candidate) {
                        continue;
                    }
                    const normalizedCandidate: string = candidate.startsWith('file://') ? fileURLToPath(candidate) : candidate;
                    if (existsSync(normalizedCandidate)) {
                        resolvedFromCatalog = normalizedCandidate;
                        break;
                    }
                }

                if (resolvedFromCatalog) {
                    resolvedPath = resolvedFromCatalog;
                } else if (this.validating) {
                    throw new Error(`RelaxNG schema file not found: ${href}`);
                } else {
                    return;
                }
            } else if (!existsSync(resolvedPath)) {
                if (this.validating) {
                    throw new Error(`RelaxNG schema file not found: ${href}`);
                }
                return;
            }
            let relaxngParser = new RelaxNGParser(resolvedPath, this.catalog);
            this.relaxNGDefaultAttributes = relaxngParser.getElements();
            this.isRelaxNG = true;
        } catch (error: unknown) {
            if (error instanceof Error) {
                throw new Error(`Error accessing RelaxNG schema at ${href}: ${error.message}`, { cause: error });
            }
            throw new Error(`Error accessing RelaxNG schema at ${href}: ${String(error)}`);
        }
    }

    private processInternalSubset(internalSubset: string, skipIfAlreadyApplied: boolean = false): void {
        if (internalSubset.trim().length === 0) {
            return;
        }
        if (skipIfAlreadyApplied && this.internalSubsetApplied) {
            return;
        }

        const existingGrammar: Grammar | undefined = this.contentHandler?.getGrammar();
        const baseDir: string | undefined = this.currentFile ? dirname(this.currentFile) : undefined;
        const parser: DTDParser = existingGrammar instanceof DTDGrammar ? new DTDParser(existingGrammar, baseDir) : new DTDParser(undefined, baseDir);
        parser.setValidating(this.validating);
        parser.setXmlVersion(this.xmlVersion);
        if (this.catalog) {
            parser.setCatalog(this.catalog);
        }
        parser.setOverrideExistingDeclarations(true);
        let updatedGrammar: DTDGrammar | undefined;
        try {
            updatedGrammar = parser.parseString(internalSubset);
        } catch (error) {
            if (this.validating) {
                throw error;
            }
        } finally {
            parser.setOverrideExistingDeclarations(false);
        }
        if (updatedGrammar) {
            this.contentHandler?.setGrammar(updatedGrammar);
        }
        this.internalSubsetApplied = true;
    }

    parseDoctype() {
        this.cleanCharacterRun();
        this.pointer += 9; // skip '<!DOCTYPE'
        // skip spaces before root name
        while (true) {
            this.ensureLookahead(1);
            if (this.pointer >= this.buffer.length) {
                if (this.sourceEnded) {
                    throw new Error('Malformed DOCTYPE declaration');
                }
                if (this.streamingMode) {
                    throw new NeedMoreDataError();
                }
            }
            let char: string = this.buffer[this.pointer];
            if (!XMLUtils.isXmlSpace(char)) {
                break;
            }
            this.pointer++;
        }
        // read name
        let name: string = '';
        while (true) {
            this.ensureLookahead(1);
            if (this.pointer >= this.buffer.length) {
                if (this.sourceEnded) {
                    throw new Error('Malformed DOCTYPE declaration: missing root name');
                }
                if (this.streamingMode) {
                    throw new NeedMoreDataError();
                }
            }
            let char: string = this.buffer.charAt(this.pointer);
            if (XMLUtils.isXmlSpace(char)) {
                break;
            }
            name += char;
            this.pointer++;
        }
        // skip spaces after root name
        while (true) {
            this.ensureLookahead(1);
            if (this.pointer >= this.buffer.length) {
                if (this.sourceEnded) {
                    break;
                }
                if (this.streamingMode) {
                    throw new NeedMoreDataError();
                }
            }
            let char: string = this.buffer[this.pointer];
            if (!XMLUtils.isXmlSpace(char)) {
                break;
            }
            this.pointer++;
        }
        // read external identifiers
        let systemId: string = '';
        if (this.lookingAt('SYSTEM')) {
            systemId = this.parseSystemDeclaration();
        }
        let publicId: string = '';
        if (this.lookingAt('PUBLIC')) {
            let pair: string[] = this.parsePublicDeclaration();
            publicId = pair[0];
            systemId = pair[1];
        }
        this.contentHandler?.startDTD(name, publicId, systemId);
        // skip spaces after SYSTEM or PUBLIC
        while (true) {
            this.ensureLookahead(1);
            if (this.pointer >= this.buffer.length) {
                if (this.sourceEnded) {
                    break;
                }
                if (this.streamingMode) {
                    throw new NeedMoreDataError();
                }
            }
            let char: string = this.buffer[this.pointer];
            if (!XMLUtils.isXmlSpace(char)) {
                break;
            }
            this.pointer++;
        }
        // check internal subset
        let internalSubset: string = '';
        if (this.lookingAt('[')) {
            this.pointer++; // skip '['
            let depth: number = 1;
            let inQuotes: boolean = false;
            let quoteChar: string = '';
            while (depth > 0) {
                this.ensureLookahead(1);
                if (this.pointer >= this.buffer.length) {
                    if (this.sourceEnded) {
                        throw new Error('Malformed DOCTYPE declaration: unterminated internal subset');
                    }
                    if (this.streamingMode) {
                        throw new NeedMoreDataError();
                    }
                }
                const char: string = this.buffer.charAt(this.pointer);
                if (inQuotes) {
                    internalSubset += char;
                    this.pointer++;
                    if (char === quoteChar) {
                        inQuotes = false;
                        quoteChar = '';
                    }
                    continue;
                }
                if (char === '"' || char === '\'') {
                    inQuotes = true;
                    quoteChar = char;
                    internalSubset += char;
                    this.pointer++;
                    continue;
                }
                if (char === '[') {
                    depth++;
                    internalSubset += char;
                    this.pointer++;
                    continue;
                }
                if (char === ']') {
                    depth--;
                    this.pointer++;
                    if (depth === 0) {
                        break;
                    }
                    internalSubset += char;
                    continue;
                }
                internalSubset += char;
                this.pointer++;
            }
        }
        if (internalSubset !== '') {
            if (/(<\?xml)(?=[\s?>])/i.test(internalSubset)) {
                throw new Error('Malformed DOCTYPE declaration: XML declaration is not allowed inside the internal subset');
            }
            this.processInternalSubset(internalSubset);
        }
        // skip spaces after internal subset
        while (true) {
            this.ensureLookahead(1);
            if (this.pointer >= this.buffer.length) {
                if (this.sourceEnded) {
                    break;
                }
                if (this.streamingMode) {
                    throw new NeedMoreDataError();
                }
            }
            let char: string = this.buffer[this.pointer];
            if (!XMLUtils.isXmlSpace(char)) {
                break;
            }
            this.pointer++;
        }
        this.pointer++; // skip '>'
        this.buffer = this.buffer.substring(this.pointer);
        this.pointer = 0;
        if (systemId !== '' || publicId !== '') {
            this.processExternalSubset(publicId, systemId);
        }
        if (internalSubset !== '') {
            this.contentHandler?.internalSubset(internalSubset);
        }
        this.processInternalSubset(internalSubset, true);
        this.contentHandler?.endDTD();
    }

    private processExternalSubset(publicId: string, systemId: string): void {
        if (systemId === '' && publicId === '') {
            return;
        }

        const resolvedLocation: string | undefined = this.resolveExternalSubsetLocation(publicId, systemId);
        if (!resolvedLocation) {
            const target: string = systemId || publicId;
            if (this.validating) {
                throw new Error(`External subset not found: ${target}`);
            }
            console.warn(`Warning: External subset not found: ${target}`);
            return;
        }

        const existingGrammar: Grammar | undefined = this.contentHandler?.getGrammar();
        const baseDir: string | undefined = this.readingFromFile && this.currentFile ? dirname(this.currentFile) : undefined;
        const parser: DTDParser = existingGrammar instanceof DTDGrammar ? new DTDParser(existingGrammar, baseDir) : new DTDParser(undefined, baseDir);
        parser.setValidating(this.validating);
        parser.setXmlVersion(this.xmlVersion);
        if (this.catalog) {
            parser.setCatalog(this.catalog);
        }
        parser.setOverrideExistingDeclarations(false);
        try {
            const updatedGrammar: DTDGrammar = parser.parseDTD(resolvedLocation);
            this.contentHandler?.setGrammar(updatedGrammar);
        } catch (error: unknown) {
            if (resolvedLocation.startsWith(tmpdir())) {
                try { unlinkSync(resolvedLocation); } catch (e: unknown) { /* ignore */ }
            }
            if (this.validating) {
                throw error;
            }
            console.warn('Warning: Failed to parse external subset ' + resolvedLocation + ': ' + (error as Error).message);
            return;
        }
        if (resolvedLocation.startsWith(tmpdir())) {
            try { unlinkSync(resolvedLocation); } catch (e: unknown) { /* ignore */ }
        }
    }

    private resolveExternalSubsetLocation(publicId: string, systemId: string): string | undefined {
        const fromCatalog: string | undefined = this.catalog?.resolveEntity(publicId, systemId);
        if (fromCatalog) {
            return fromCatalog;
        }

        if (!systemId) {
            return undefined;
        }

        const lowerSystemId: string = systemId.toLowerCase();
        if (lowerSystemId.startsWith('http://') || lowerSystemId.startsWith('https://')) {
            if (this.validating) {
                return this.resolveHttp(systemId);
            }
            console.warn(`Warning: External subset over HTTP/HTTPS is not supported: ${systemId}`);
            return undefined;
        }

        if (this.readingFromFile && this.currentFile) {
            const documentDir: string = dirname(this.currentFile);
            const relativeCandidate: string = resolve(documentDir, systemId);
            if (existsSync(relativeCandidate)) {
                return relativeCandidate;
            }
        }

        if (isAbsolute(systemId) && existsSync(systemId)) {
            return systemId;
        }

        const absoluteCandidate: string = resolve(systemId);
        if (existsSync(absoluteCandidate)) {
            return absoluteCandidate;
        }

        return undefined;
    }

    parsePublicDeclaration(): string[] {
        this.pointer += 6; // skip 'PUBLIC'
        // skip spaces after PUBLIC
        while (true) {
            this.ensureLookahead(1);
            if (this.pointer >= this.buffer.length) {
                if (this.sourceEnded) {
                    throw new Error('Malformed PUBLIC declaration');
                }
                if (this.streamingMode) {
                    throw new NeedMoreDataError();
                }
            }
            let char: string = this.buffer[this.pointer];
            if (!XMLUtils.isXmlSpace(char)) {
                break;
            }
            this.pointer++;
        }
        let separator: string = '';
        let publicId: string = '';
        while (true) {
            this.ensureLookahead(1);
            if (this.pointer >= this.buffer.length) {
                if (this.sourceEnded) {
                    throw new Error('Malformed PUBLIC declaration: unterminated public identifier');
                }
                if (this.streamingMode) {
                    throw new NeedMoreDataError();
                }
            }
            let char: string = this.buffer[this.pointer];
            if (separator === '') {
                if (char === '\'' || char === '"') {
                    separator = char;
                    this.pointer++;
                    continue;
                }
                throw new Error('Malformed PUBLIC declaration: missing opening quote');
            }
            if (char === separator) {
                this.pointer++;
                break;
            }
            publicId += char;
            this.pointer++;
        }
        // skip spaces after publicId
        while (true) {
            this.ensureLookahead(1);
            if (this.pointer >= this.buffer.length) {
                if (this.sourceEnded) {
                    break;
                }
                if (this.streamingMode) {
                    throw new NeedMoreDataError();
                }
            }
            let char: string = this.buffer[this.pointer];
            if (!XMLUtils.isXmlSpace(char)) {
                break;
            }
            this.pointer++;
        }
        separator = '';
        let systemIdId: string = '';
        while (true) {
            this.ensureLookahead(1);
            if (this.pointer >= this.buffer.length) {
                if (this.sourceEnded) {
                    throw new Error('Malformed PUBLIC declaration: unterminated system identifier');
                }
                if (this.streamingMode) {
                    throw new NeedMoreDataError();
                }
            }
            let char: string = this.buffer[this.pointer];
            if (separator === '') {
                if (char === '\'' || char === '"') {
                    separator = char;
                    this.pointer++;
                    continue;
                }
                throw new Error('Malformed PUBLIC declaration: missing system identifier quote');
            }
            if (char === separator) {
                this.pointer++;
                break;
            }
            systemIdId += char;
            this.pointer++;
        }
        return [publicId, systemIdId];
    }

    parseSystemDeclaration(): string {
        this.pointer += 6; // skip 'SYSTEM'
        // skip spaces after SYSTEM
        while (true) {
            this.ensureLookahead(1);
            if (this.pointer >= this.buffer.length) {
                if (this.sourceEnded) {
                    throw new Error('Malformed SYSTEM declaration');
                }
                if (this.streamingMode) {
                    throw new NeedMoreDataError();
                }
            }
            let char: string = this.buffer[this.pointer];
            if (!XMLUtils.isXmlSpace(char)) {
                break;
            }
            this.pointer++;
        }
        let separator: string = '';
        let systemId: string = '';
        while (true) {
            this.ensureLookahead(1);
            if (this.pointer >= this.buffer.length) {
                if (this.sourceEnded) {
                    throw new Error('Malformed SYSTEM declaration: unterminated system identifier');
                }
                if (this.streamingMode) {
                    throw new NeedMoreDataError();
                }
            }
            let char: string = this.buffer[this.pointer];
            if (separator === '') {
                if (char === '\'' || char === '"') {
                    separator = char;
                    this.pointer++;
                    continue;
                }
                throw new Error('Malformed SYSTEM declaration: missing opening quote');
            }
            if (char === separator) {
                this.pointer++;
                break;
            }
            systemId += char;
            this.pointer++;
        }
        return systemId;
    }

    parseXMLDeclaration() {
        if (this.xmlDeclarationParsed) {
            throw new Error('Malformed XML declaration: multiple declarations are not allowed');
        }
        if (this.rootParsed) {
            throw new Error('Malformed XML declaration: declaration cannot appear after the root element');
        }
        if (this.leadingContentBeforeXmlDeclaration) {
            throw new Error('Malformed XML declaration: declaration must be the first content in the document');
        }
        let declarationText: string = '';
        this.pointer += 6; // skip '<?xml '
        while (true) {
            this.ensureLookahead(2);
            if (this.pointer >= this.buffer.length) {
                if (this.sourceEnded) {
                    throw new Error('Malformed XML declaration: unterminated declaration');
                }
                if (this.streamingMode) {
                    throw new NeedMoreDataError();
                }
            }
            if (this.lookingAt('?>')) {
                break;
            }
            const codePoint: number = this.buffer.codePointAt(this.pointer)!;
            XMLUtils.ensureValidXmlCodePoint(this.xmlVersion, codePoint, 'XML declaration');
            const char: string = String.fromCodePoint(codePoint);
            declarationText += char;
            this.pointer += char.length;
        }
        declarationText = declarationText.trim();
        const attributePairs: Array<{ name: string; value: string }> = this.parseAttributePairs(declarationText);
        const attributes: Map<string, string> = new Map<string, string>();
        attributePairs.forEach((pair) => attributes.set(pair.name, pair.value));
        const allowedPseudoAttributes: Set<string> = new Set<string>(['version', 'encoding', 'standalone']);
        attributePairs.forEach((pair, index) => {
            const key: string = pair.name;
            if (!allowedPseudoAttributes.has(key)) {
                throw new Error('Malformed XML declaration: invalid pseudo-attribute "' + key + '"');
            }
            if (key === 'version' && index !== 0) {
                throw new Error('Malformed XML declaration: "version" pseudo-attribute must appear first');
            }
            if (key === 'encoding') {
                if (index === 0) {
                    throw new Error('Malformed XML declaration: "encoding" pseudo-attribute must follow "version"');
                }
                if (attributePairs[index - 1].name !== 'version') {
                    throw new Error('Malformed XML declaration: "encoding" pseudo-attribute must immediately follow "version"');
                }
            }
            if (key === 'standalone') {
                if (index === 0) {
                    throw new Error('Malformed XML declaration: "standalone" pseudo-attribute must follow "version"');
                }
                const previousNames: Set<string> = new Set<string>(attributePairs.slice(0, index).map((entry) => entry.name));
                if (!previousNames.has('version')) {
                    throw new Error('Malformed XML declaration: "standalone" pseudo-attribute requires "version"');
                }
                if (previousNames.has('encoding') && attributePairs[index - 1].name !== 'encoding') {
                    throw new Error('Malformed XML declaration: "standalone" pseudo-attribute must follow "encoding" when both are present');
                }
            }
        });
        const versionValue: string | undefined = attributes.get('version');
        if (!versionValue) {
            throw new Error('Malformed XML declaration: missing required "version" pseudo-attribute');
        }
        const encodingValue: string | undefined = attributes.get('encoding');
        let encoding: string = 'UTF-8';
        if (encodingValue !== undefined) {
            const canonicalEncoding: string = this.validateEncodingValue(encodingValue);
            attributes.set('encoding', canonicalEncoding);
            encoding = canonicalEncoding;
        }
        const standaloneValue: string | undefined = attributes.get('standalone');
        if (standaloneValue !== undefined && standaloneValue !== 'yes' && standaloneValue !== 'no') {
            throw new Error('Malformed XML declaration: invalid value "' + standaloneValue + '" for "standalone"');
        }
        this.buffer = this.buffer.substring(this.pointer + 2); // skip '?>'
        this.pointer = 0;
        const version: string = versionValue;
        this.xmlVersion = version;
        this.contentHandler?.xmlDeclaration(version, encoding, attributes.get('standalone'));
        this.xmlDeclarationParsed = true;
        this.leadingContentBeforeXmlDeclaration = false;
    }

    lookingAt(text: string): boolean {
        const length: number = text.length;
        try {
            this.ensureLookahead(length);
        } catch (error) {
            if (error instanceof NeedMoreDataError) {
                throw error;
            }
            throw error;
        }
        if (this.pointer + length > this.buffer.length) {
            return false;
        }
        for (let i: number = 0; i < length; i++) {
            if (this.buffer[this.pointer + i] !== text[i]) {
                return false;
            }
        }
        return true;
    }

    private parseAttributePairs(text: string): Array<{ name: string; value: string }> {
        const originalText: string = text;
        const pairs: Array<{ name: string; value: string }> = [];
        const seen: Set<string> = new Set<string>();
        let index: number = 0;
        while (index < text.length) {
            while (index < text.length && XMLUtils.isXmlSpace(text.charAt(index))) {
                index++;
            }
            if (index >= text.length) {
                break;
            }
            const terminator: string = text.charAt(index);
            if (terminator === '?' || terminator === '/' || terminator === '>') {
                break;
            }
            const nameStart: number = index;
            while (index < text.length) {
                const char: string = text.charAt(index);
                if (char === '=' || XMLUtils.isXmlSpace(char)) {
                    break;
                }
                index++;
            }
            const name: string = text.substring(nameStart, index);
            if (name === '') {
                throw new Error('Malformed attributes list in "' + originalText + '"');
            }
            while (index < text.length && XMLUtils.isXmlSpace(text.charAt(index))) {
                index++;
            }
            if (index >= text.length || text.charAt(index) !== '=') {
                throw new Error('Malformed attributes list in "' + originalText + '": missing "=" after attribute name "' + name + '"');
            }
            index++; // skip '='
            while (index < text.length && XMLUtils.isXmlSpace(text.charAt(index))) {
                index++;
            }
            if (index >= text.length) {
                throw new Error('Malformed attributes list in "' + originalText + '": missing attribute value for "' + name + '"');
            }
            const quoteChar: string = text.charAt(index);
            if (quoteChar !== '"' && quoteChar !== '\'') {
                throw new Error('Malformed attributes list in "' + originalText + '": attribute "' + name + '" must start with quote');
            }
            index++; // skip opening quote
            const valueStart: number = index;
            while (index < text.length && text.charAt(index) !== quoteChar) {
                index++;
            }
            if (index >= text.length) {
                throw new Error('Malformed attributes list in "' + originalText + '": attribute "' + name + '" is missing closing quote');
            }
            const value: string = text.substring(valueStart, index);
            if (value.indexOf('<') !== -1) {
                throw new Error('Malformed attributes list in "' + originalText + '": attribute "' + name + '" contains forbidden character "<"');
            }
            index++; // skip closing quote
            if (index < text.length) {
                const separatorChar: string = text.charAt(index);
                if (separatorChar === '?' || separatorChar === '/' || separatorChar === '>') {
                    // Terminators handled by caller; leave index as-is so outer logic can exit.
                } else if (!XMLUtils.isXmlSpace(separatorChar)) {
                    throw new Error('Malformed attributes list: attribute "' + name + '" must be followed by whitespace in "' + originalText + '"');
                }
            }
            if (seen.has(name)) {
                throw new Error(`Malformed attributes list: duplicate attribute "${name}" in "${originalText}"`);
            }
            seen.add(name);
            pairs.push({ name, value });
        }
        return pairs;
    }

    parseAttributes(text: string): Map<string, string> {
        const map: Map<string, string> = new Map<string, string>();
        const pairs: Array<{ name: string; value: string }> = this.parseAttributePairs(text);
        pairs.forEach((pair) => {
            map.set(pair.name, pair.value);
        });
        return map;
    }

    private validateEncodingValue(rawEncoding: string): string {
        if (!SAXParser.ENCODING_NAME_PATTERN.test(rawEncoding)) {
            throw new Error('Malformed XML declaration: invalid encoding name "' + rawEncoding + '"');
        }
        const normalized: string = rawEncoding.toUpperCase();
        const canonical: string | undefined = SAXParser.SUPPORTED_ENCODINGS.get(normalized);
        if (!canonical) {
            throw new Error('Malformed XML declaration: unsupported encoding "' + rawEncoding + '"');
        }
        return canonical;
    }

    private normalizeDTDAttributes(elementName: string, attributes: Map<string, string>): Map<string, string> {
        const grammar: Grammar | undefined = this.contentHandler?.getGrammar();
        // NOTE: When new Grammar implementations (RelaxNG, XML Schema) arrive, re-evaluate this branch to respect their normalization rules.
        if (!(grammar instanceof DTDGrammar)) {
            return attributes;
        }
        const declarations: Map<string, AttDecl> | undefined = grammar.getElementAttributesMap(elementName);
        if (!declarations || declarations.size === 0) {
            return attributes;
        }
        const normalized: Map<string, string> = new Map<string, string>();
        attributes.forEach((value: string, name: string) => {
            const expanded: string = this.decodeAttributeEntities(value, grammar);
            XMLUtils.ensureValidXmlCharacters(this.xmlVersion, expanded, 'attribute value');
            const decl = declarations.get(name);
            normalized.set(name, this.normalizeAttributeValue(value, expanded, decl));
        });
        return normalized;
    }

    private normalizeAttributeValue(rawValue: string, expandedValue: string, decl?: AttDecl): string {
        const hasLineFeedReference: boolean = this.containsNumericCharReference(rawValue, 0x0A);
        const hasCarriageReturnReference: boolean = this.containsNumericCharReference(rawValue, 0x0D);
        const hasTabReference: boolean = this.containsNumericCharReference(rawValue, 0x09);

        let result: string = expandedValue;
        const hasLiteralLineBreak: boolean = rawValue.indexOf('\n') !== -1 || rawValue.indexOf('\r') !== -1;

        if (hasLiteralLineBreak) {
            result = result.replaceAll('\r\n', '\n');
        }

        if (!hasCarriageReturnReference) {
            result = result.replaceAll('\r', '\n');
        }

        if (!decl || decl.getType() === 'CDATA') {
            if (!hasLineFeedReference) {
                result = result.replaceAll('\n', ' ');
            }
            if (!hasCarriageReturnReference) {
                result = result.replaceAll('\r', ' ');
            }
            if (!hasTabReference) {
                result = result.replaceAll('\t', ' ');
            }
            return result;
        }

        result = result.replaceAll('\n', ' ').replaceAll('\r', ' ').replaceAll('\t', ' ');
        return result.replaceAll(/ +/g, ' ').trim();
    }

    private containsNumericCharReference(rawValue: string, codePoint: number): boolean {
        const pattern: RegExp = /&#(x[0-9a-fA-F]+|\d+);/g;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(rawValue)) !== null) {
            const token: string = match[1];
            let value: number;
            if (token[0] === 'x' || token[0] === 'X') {
                value = Number.parseInt(token.substring(1), 16);
            } else {
                value = Number.parseInt(token, 10);
            }
            if (value === codePoint) {
                return true;
            }
        }
        return false;
    }

    private decodeAttributeEntities(value: string, grammar: DTDGrammar | undefined): string {
        if (value.indexOf('&') === -1) {
            return value;
        }
        let result: string = '';
        let index: number = 0;
        while (index < value.length) {
            const ampIndex: number = value.indexOf('&', index);
            if (ampIndex === -1) {
                const tail: string = value.substring(index);
                XMLUtils.ensureValidXmlCharacters(this.xmlVersion, tail, 'attribute value');
                result += tail;
                break;
            }
            const plainSegment: string = value.substring(index, ampIndex);
            XMLUtils.ensureValidXmlCharacters(this.xmlVersion, plainSegment, 'attribute value');
            result += plainSegment;
            const semiIndex: number = value.indexOf(';', ampIndex + 1);
            if (semiIndex === -1) {
                throw new Error('Malformed XML document: unterminated entity reference in attribute value');
            }
            const entityName: string = value.substring(ampIndex + 1, semiIndex);
            if (entityName.length === 0) {
                throw new Error('Malformed XML document: empty entity reference in attribute value');
            }
            if (entityName.startsWith('#x')) {
                const parsed: number = Number.parseInt(entityName.substring(2), 16);
                XMLUtils.ensureValidXmlCodePoint(this.xmlVersion, parsed, `character reference &#x${entityName.substring(2)}; in attribute value`);
                result += String.fromCodePoint(parsed);
            } else if (entityName.startsWith('#')) {
                const parsed: number = Number.parseInt(entityName.substring(1), 10);
                XMLUtils.ensureValidXmlCodePoint(this.xmlVersion, parsed, `character reference &#${entityName.substring(1)}; in attribute value`);
                result += String.fromCodePoint(parsed);
            } else if (entityName === 'lt') {
                result += '<';
            } else if (entityName === 'gt') {
                result += '>';
            } else if (entityName === 'amp') {
                result += '&';
            } else if (entityName === 'apos') {
                result += '\'';
            } else if (entityName === 'quot') {
                result += '"';
            } else {
                const replacement: string | undefined = grammar?.resolveEntity(entityName);
                if (replacement !== undefined) {
                    result += this.expandEntityReplacement(replacement, grammar, 0, new Set<string>([entityName]));
                } else {
                    throw new Error(`Malformed XML document: undefined general entity &${entityName}; in attribute value`);
                }
            }
            index = semiIndex + 1;
        }
        XMLUtils.ensureValidXmlCharacters(this.xmlVersion, result, 'attribute value');
        return result;
    }

    private expandEntityReplacement(value: string, grammar: Grammar | undefined, depth: number = 0, expansionStack: Set<string> = new Set<string>()): string {
        if (depth > 50) {
            throw new Error(`Entity expansion depth exceeded (possible recursion): ${Array.from(expansionStack).join(' -> ')}`);
        }
        let result = '';
        let index = 0;
        while (index < value.length) {
            const ampIndex = value.indexOf('&', index);
            if (ampIndex === -1) {
                const tail: string = value.substring(index);
                XMLUtils.ensureValidXmlCharacters(this.xmlVersion, tail, 'entity replacement text');
                result += tail;
                break;
            }
            const plainSegment: string = value.substring(index, ampIndex);
            XMLUtils.ensureValidXmlCharacters(this.xmlVersion, plainSegment, 'entity replacement text');
            result += plainSegment;
            const semiIndex = value.indexOf(';', ampIndex + 1);
            if (semiIndex === -1) {
                result += value.substring(ampIndex);
                break;
            }
            const entityName = value.substring(ampIndex + 1, semiIndex);
            if (entityName.length === 0) {
                result += '&;';
                index = semiIndex + 1;
                continue;
            }
            if (entityName === 'lt' || entityName === 'gt' || entityName === 'amp' || entityName === 'apos' || entityName === 'quot') {
                result += '&' + entityName + ';';
            } else if (entityName.startsWith('#x')) {
                const parsed = Number.parseInt(entityName.substring(2), 16);
                XMLUtils.ensureValidXmlCodePoint(this.xmlVersion, parsed, `character reference &#x${entityName.substring(2)}; in entity replacement`);
                result += String.fromCodePoint(parsed);
            } else if (entityName.startsWith('#')) {
                const parsed = Number.parseInt(entityName.substring(1), 10);
                XMLUtils.ensureValidXmlCodePoint(this.xmlVersion, parsed, `character reference &#${entityName.substring(1)}; in entity replacement`);
                result += String.fromCodePoint(parsed);
            } else {
                const nested = grammar?.resolveEntity(entityName);
                if (nested !== undefined) {
                    if (expansionStack.has(entityName)) {
                        const chain = Array.from(expansionStack).concat(entityName).join(' -> ');
                        throw new Error(`Recursive entity reference detected: ${chain}`);
                    }
                    const nextStack = new Set<string>(expansionStack);
                    nextStack.add(entityName);
                    result += this.expandEntityReplacement(nested, grammar, depth + 1, nextStack);
                } else {
                    result += '&' + entityName + ';';
                }
            }
            index = semiIndex + 1;
        }
        XMLUtils.ensureValidXmlCharacters(this.xmlVersion, result, 'entity replacement text');
        return result;
    }

    startCDATA() {
        this.cleanCharacterRun();
        this.pointer += 9; // skip '<![CDATA['
        this.buffer = this.buffer.substring(this.pointer);
        this.pointer = 0;
        this.inCDATASection = true;
        this.contentHandler?.startCDATA();
    }

    endCDATA() {
        this.cleanCharacterRun();
        this.pointer += 3; // skip ']]>'
        this.buffer = this.buffer.substring(this.pointer);
        this.pointer = 0;
        this.inCDATASection = false;
        this.contentHandler?.endCDATA();
    }
}