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

import { readFile, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { DOMBuilder } from "../DOMBuilder.js";
import { SAXParser, ParseSourceOptions, StreamParseOptions } from "../SAXParser.js";
import { XMLDocument } from "../XMLDocument.js";
import { XMLElement } from "../XMLElement.js";
import { XMLAttribute } from "../XMLAttribute.js";
import { TextNode } from "../TextNode.js";
import { CData } from "../CData.js";
import { XMLComment } from "../XMLComment.js";
import { ProcessingInstruction } from "../ProcessingInstruction.js";
import { XMLDeclaration } from "../XMLDeclaration.js";
import { XMLDocumentType } from "../XMLDocumentType.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonElementObject | Array<JsonValue>;

export interface JsonElementObject {
    _attributes?: Record<string, string | number | boolean | null>;
    _text?: string;
    _cdata?: string | Array<string>;
    _comments?: string | Array<string>;
    _processingInstructions?: Array<JsonProcessingInstruction>;
    _content?: Array<JsonElementContentNode>;
    [childName: string]: JsonValue | Array<JsonValue> | string | Array<string> | Array<JsonProcessingInstruction> | Record<string, string | number | boolean | null> | Array<JsonElementContentNode> | undefined;
}

export interface JsonProcessingInstruction {
    target: string;
    data?: string;
}

export interface JsonElementContentTextNode {
    kind: "text";
    value: string;
}

export interface JsonElementContentCDataNode {
    kind: "cdata";
    value: string;
}

export interface JsonElementContentCommentNode {
    kind: "comment";
    value: string;
}

export interface JsonElementContentProcessingInstructionNode {
    kind: "processingInstruction";
    target: string;
    data?: string;
}

export interface JsonElementContentElementNode {
    kind: "element";
    name: string;
    occurrence: number;
}

export type JsonElementContentNode =
    | JsonElementContentTextNode
    | JsonElementContentCDataNode
    | JsonElementContentCommentNode
    | JsonElementContentProcessingInstructionNode
    | JsonElementContentElementNode;

export interface XmlJsonDeclaration {
    version?: string;
    encoding?: string;
    standalone?: string;
}

export interface XmlJsonDoctype {
    name: string;
    publicId?: string;
    systemId?: string;
    internalSubset?: string;
}

export interface JsonCommentNode {
    type: "comment";
    value: string;
}

export interface JsonProcessingInstructionNode {
    type: "processingInstruction";
    target: string;
    data?: string;
}

export interface JsonTextNode {
    type: "text";
    value: string;
}

export type JsonMiscNode = JsonCommentNode | JsonProcessingInstructionNode | JsonTextNode;

export type JsonPrologNode = JsonMiscNode & {
    afterDoctype?: boolean;
};

export interface XmlJsonDocument {
    rootName: string;
    root: JsonValue;
    declaration?: XmlJsonDeclaration;
    doctype?: XmlJsonDoctype;
    prolog?: Array<JsonPrologNode>;
    epilog?: Array<JsonMiscNode>;
}

export type JsonConversionMode = "simple" | "roundtrip";

export interface XmlDocumentToJsonSimpleOptions {
    mode?: "simple";
}

export interface XmlDocumentToJsonRoundTripOptions {
    mode: "roundtrip";
}

export type XmlDocumentToJsonOptions = XmlDocumentToJsonSimpleOptions | XmlDocumentToJsonRoundTripOptions;

export interface XmlToJsonSimpleOptions extends ParseSourceOptions {
    mode?: "simple";
}

export interface XmlToJsonRoundTripOptions extends ParseSourceOptions {
    mode: "roundtrip";
}

export type XmlToJsonOptions = XmlToJsonSimpleOptions | XmlToJsonRoundTripOptions;

export interface XmlFileToJsonSimpleOptions extends XmlDocumentToJsonSimpleOptions {
    encoding?: BufferEncoding;
}

export interface XmlFileToJsonRoundTripOptions extends XmlDocumentToJsonRoundTripOptions {
    encoding?: BufferEncoding;
}

export type XmlFileToJsonOptions = XmlFileToJsonSimpleOptions | XmlFileToJsonRoundTripOptions;

export interface XmlStreamToJsonSimpleOptions extends StreamParseOptions {
    mode?: "simple";
}

export interface XmlStreamToJsonRoundTripOptions extends StreamParseOptions {
    mode: "roundtrip";
}

export type XmlStreamToJsonOptions = XmlStreamToJsonSimpleOptions | XmlStreamToJsonRoundTripOptions;

const RESERVED_KEYS: ReadonlySet<string> = new Set<string>([
    "_attributes",
    "_text",
    "_cdata",
    "_comments",
    "_processingInstructions",
    "_content"
]);

export function xmlStringToJsonObject(xml: string, options?: XmlToJsonSimpleOptions): JsonValue;
export function xmlStringToJsonObject(xml: string, options: XmlToJsonRoundTripOptions): XmlJsonDocument;
export function xmlStringToJsonObject(xml: string, options?: XmlToJsonOptions): JsonValue | XmlJsonDocument {
    const { mode = "simple", ...parseOptions } = options ?? {};
    const document: XMLDocument = parseXmlFromString(xml, parseOptions);
    if (mode === "roundtrip") {
        return xmlDocumentToJsonObject(document, { mode: "roundtrip" });
    }
    return xmlDocumentToJsonObject(document);
}

export async function xmlFileToJsonObject(path: string, options?: XmlFileToJsonSimpleOptions): Promise<JsonValue>;
export async function xmlFileToJsonObject(path: string, options: XmlFileToJsonRoundTripOptions): Promise<XmlJsonDocument>;
export async function xmlFileToJsonObject(path: string, options?: XmlFileToJsonOptions): Promise<JsonValue | XmlJsonDocument> {
    const mode: JsonConversionMode = options?.mode ?? "simple";
    const encoding: BufferEncoding = options?.encoding ?? "utf8";
    const xmlText: string = await readFile(path, { encoding });
    if (mode === "roundtrip") {
        return xmlStringToJsonObject(xmlText, { mode: "roundtrip" });
    }
    return xmlStringToJsonObject(xmlText);
}

export async function xmlStreamToJsonObject(stream: Readable, options?: XmlStreamToJsonSimpleOptions): Promise<JsonValue>;
export async function xmlStreamToJsonObject(stream: Readable, options: XmlStreamToJsonRoundTripOptions): Promise<XmlJsonDocument>;
export async function xmlStreamToJsonObject(stream: Readable, options?: XmlStreamToJsonOptions): Promise<JsonValue | XmlJsonDocument> {
    const { mode = "simple", ...streamOptions } = options ?? {};
    const document: XMLDocument = await parseXmlFromStream(stream, streamOptions);
    if (mode === "roundtrip") {
        return xmlDocumentToJsonObject(document, { mode: "roundtrip" });
    }
    return xmlDocumentToJsonObject(document);
}

export function xmlDocumentToJsonObject(document: XMLDocument, options?: XmlDocumentToJsonSimpleOptions): JsonValue;
export function xmlDocumentToJsonObject(document: XMLDocument, options: XmlDocumentToJsonRoundTripOptions): XmlJsonDocument;
export function xmlDocumentToJsonObject(document: XMLDocument, options?: XmlDocumentToJsonOptions): JsonValue | XmlJsonDocument {
    const root: XMLElement | undefined = document.getRoot();
    if (!root) {
        throw new Error("XML document does not contain a root element");
    }

    const mode: JsonConversionMode = options?.mode ?? "simple";
    const includeOrderedContent: boolean = mode === "roundtrip";
    const rootValue: JsonValue = elementToJsonValue(root, { includeOrderedContent });

    if (mode !== "roundtrip") {
        return rootValue;
    }

    const result: XmlJsonDocument = {
        rootName: root.getName(),
        root: rootValue
    };

    const declaration: XMLDeclaration | undefined = document.getXmlDeclaration();
    if (declaration) {
        const declarationJson: XmlJsonDeclaration = {};
        if (declaration.getVersion()) {
            declarationJson.version = declaration.getVersion();
        }
        if (declaration.getEncoding()) {
            declarationJson.encoding = declaration.getEncoding();
        }
        const standalone: string | undefined = declaration.getStandalone();
        if (standalone !== undefined) {
            declarationJson.standalone = standalone;
        }
        if (Object.keys(declarationJson).length > 0) {
            result.declaration = declarationJson;
        }
    }

    const docType: XMLDocumentType | undefined = document.getDocumentType();
    if (docType) {
        const doctypeJson: XmlJsonDoctype = {
            name: (docType as unknown as { name: string }).name
        };
        const publicId: string = docType.getPublicId();
        if (publicId) {
            doctypeJson.publicId = publicId;
        }
        const systemId: string = docType.getSystemId();
        if (systemId) {
            doctypeJson.systemId = systemId;
        }
        const internalSubset: string | undefined = docType.getInternalSubset();
        if (internalSubset) {
            doctypeJson.internalSubset = internalSubset;
        }
        result.doctype = doctypeJson;
    }

    const prolog: Array<JsonPrologNode> = [];
    const epilog: Array<JsonMiscNode> = [];
    let seenRoot: boolean = false;
    let docTypeEncountered: boolean = false;

    for (const node of document.contentIterator()) {
        if (node instanceof XMLDeclaration) {
            continue;
        }
        if (node instanceof XMLDocumentType) {
            docTypeEncountered = true;
            continue;
        }
        if (node instanceof XMLElement) {
            if (!seenRoot) {
                seenRoot = true;
            }
            continue;
        }
        if (node instanceof XMLComment) {
            if (seenRoot) {
                const entry: JsonCommentNode = { type: "comment", value: node.getValue() };
                epilog.push(entry);
            } else {
                const entry: JsonPrologNode = { type: "comment", value: node.getValue() };
                if (docTypeEncountered) {
                    entry.afterDoctype = true;
                }
                prolog.push(entry);
            }
            continue;
        }
        if (node instanceof ProcessingInstruction) {
            const data: string = node.getData();
            const entryBase: JsonProcessingInstructionNode = {
                type: "processingInstruction",
                target: node.getTarget()
            };
            if (data && data.length > 0) {
                entryBase.data = data;
            }
            if (seenRoot) {
                epilog.push(entryBase);
            } else {
                const entry: JsonPrologNode = { ...entryBase };
                if (docTypeEncountered) {
                    entry.afterDoctype = true;
                }
                prolog.push(entry);
            }
            continue;
        }
        if (node instanceof TextNode) {
            const entryBase: JsonTextNode = {
                type: "text",
                value: node.getValue()
            };
            if (seenRoot) {
                epilog.push(entryBase);
            } else {
                const entry: JsonPrologNode = { ...entryBase };
                if (docTypeEncountered) {
                    entry.afterDoctype = true;
                }
                prolog.push(entry);
            }
        }
    }

    if (prolog.length > 0) {
        result.prolog = prolog;
    }
    if (epilog.length > 0) {
        result.epilog = epilog;
    }

    return result;
}

export async function xmlStringToJsonFile(xml: string, targetPath: string, options?: XmlToJsonOptions, indent: number | string = 2, encoding: BufferEncoding = "utf8"): Promise<void> {
    const payloadSource: JsonValue | XmlJsonDocument = options?.mode === "roundtrip"
        ? xmlStringToJsonObject(xml, options as XmlToJsonRoundTripOptions)
        : xmlStringToJsonObject(xml, options as XmlToJsonSimpleOptions | undefined);
    const payload: string = JSON.stringify(payloadSource, null, indent);
    await writeFile(targetPath, payload, { encoding });
}

export async function xmlFileToJsonFile(path: string, targetPath: string, xmlEncoding: BufferEncoding = "utf8", indent: number | string = 2, jsonEncoding: BufferEncoding = "utf8", options?: XmlDocumentToJsonOptions): Promise<void> {
    const document: XMLDocument = await parseXmlFromFile(path, xmlEncoding);
    await xmlDocumentToJsonFile(document, targetPath, indent, jsonEncoding, options);
}

export async function xmlStreamToJsonFile(stream: Readable, targetPath: string, options?: XmlStreamToJsonOptions, indent: number | string = 2, encoding: BufferEncoding = "utf8"): Promise<void> {
    const { mode = "simple", ...streamOptions } = options ?? {};
    const document: XMLDocument = await parseXmlFromStream(stream, streamOptions);
    if (mode === "roundtrip") {
        await xmlDocumentToJsonFile(document, targetPath, indent, encoding, { mode: "roundtrip" });
    } else {
        await xmlDocumentToJsonFile(document, targetPath, indent, encoding);
    }
}

export async function xmlDocumentToJsonFile(document: XMLDocument, targetPath: string, indent: number | string = 2, encoding: BufferEncoding = "utf8", options?: XmlDocumentToJsonOptions): Promise<void> {
    const payloadSource: JsonValue | XmlJsonDocument = options?.mode === "roundtrip"
        ? xmlDocumentToJsonObject(document, options as XmlDocumentToJsonRoundTripOptions)
        : xmlDocumentToJsonObject(document, options as XmlDocumentToJsonSimpleOptions | undefined);
    const payload: string = JSON.stringify(payloadSource, null, indent);
    await writeFile(targetPath, payload, { encoding });
}

export function jsonObjectToXmlDocument(json: JsonValue | XmlJsonDocument, rootElementName?: string): XMLDocument {
    if (isXmlJsonDocument(json)) {
        return jsonDocumentToXmlDocument(json);
    }
    const resolvedRootName: string = rootElementName !== undefined
        ? rootElementName
        : inferRootElementNameFromSimpleJson(json as JsonValue) ?? "json";
    return simpleJsonObjectToXmlDocument(json as JsonValue, resolvedRootName);
}

export function jsonStringToXmlDocument(jsonText: string, rootElementName: string = "json"): XMLDocument {
    const parsed: unknown = JSON.parse(jsonText);
    return jsonObjectToXmlDocument(parsed as JsonValue | XmlJsonDocument, rootElementName);
}

export async function jsonFileToXmlDocument(path: string, rootElementName: string = "json", encoding: BufferEncoding = "utf8"): Promise<XMLDocument> {
    const jsonText: string = await readFile(path, { encoding });
    return jsonStringToXmlDocument(jsonText, rootElementName);
}

export async function jsonStreamToXmlDocument(stream: Readable, rootElementName: string = "json", encoding: BufferEncoding = "utf8"): Promise<XMLDocument> {
    const jsonText: string = await readStreamToString(stream, encoding);
    return jsonStringToXmlDocument(jsonText, rootElementName);
}

export async function jsonObjectToXmlFile(json: JsonValue | XmlJsonDocument, targetPath: string, rootElementName: string = "json", encoding: BufferEncoding = "utf8"): Promise<void> {
    const document: XMLDocument = jsonObjectToXmlDocument(json, rootElementName);
    await writeFile(targetPath, document.toString(), { encoding });
}

export async function jsonStringToXmlFile(jsonText: string, targetPath: string, rootElementName: string = "json", encoding: BufferEncoding = "utf8"): Promise<void> {
    const document: XMLDocument = jsonStringToXmlDocument(jsonText, rootElementName);
    await writeFile(targetPath, document.toString(), { encoding });
}

export async function jsonFileToXmlFile(path: string, targetPath: string, rootElementName: string = "json", jsonEncoding: BufferEncoding = "utf8", xmlEncoding: BufferEncoding = "utf8"): Promise<void> {
    const document: XMLDocument = await jsonFileToXmlDocument(path, rootElementName, jsonEncoding);
    await writeFile(targetPath, document.toString(), { encoding: xmlEncoding });
}

export async function jsonStreamToXmlFile(stream: Readable, targetPath: string, rootElementName: string = "json", jsonEncoding: BufferEncoding = "utf8", xmlEncoding: BufferEncoding = "utf8"): Promise<void> {
    const document: XMLDocument = await jsonStreamToXmlDocument(stream, rootElementName, jsonEncoding);
    await writeFile(targetPath, document.toString(), { encoding: xmlEncoding });
}

function parseXmlFromString(xml: string, options?: ParseSourceOptions): XMLDocument {
    const builder: DOMBuilder = new DOMBuilder();
    builder.initialize();
    const parser: SAXParser = new SAXParser();
    parser.setContentHandler(builder);
    parser.parseString(xml, options);
    const document: XMLDocument | undefined = builder.getDocument();
    if (!document) {
        throw new Error("Unable to parse XML string");
    }
    return document;
}

async function parseXmlFromFile(path: string, encoding: BufferEncoding = "utf8"): Promise<XMLDocument> {
    const xmlText: string = await readFile(path, { encoding });
    return parseXmlFromString(xmlText);
}

async function parseXmlFromStream(stream: Readable, options?: StreamParseOptions): Promise<XMLDocument> {
    const builder: DOMBuilder = new DOMBuilder();
    builder.initialize();
    const parser: SAXParser = new SAXParser();
    parser.setContentHandler(builder);
    await parser.parseStream(stream, options);
    const document: XMLDocument | undefined = builder.getDocument();
    if (!document) {
        throw new Error("Unable to parse XML stream");
    }
    return document;
}

interface ElementConversionConfig {
    includeOrderedContent: boolean;
}

function elementToJsonValue(element: XMLElement, config: ElementConversionConfig): JsonValue {
    const attributes: Array<XMLAttribute> = element.getAttributes();
    const childGroups: Map<string, Array<JsonValue>> = new Map<string, Array<JsonValue>>();
    const textPieces: Array<string> = new Array<string>();
    const cdataPieces: Array<string> = new Array<string>();
    const commentPieces: Array<string> = new Array<string>();
    const processingInstructions: Array<JsonProcessingInstruction> = new Array<JsonProcessingInstruction>();
    const orderedContent: Array<JsonElementContentNode> | undefined = config.includeOrderedContent ? new Array<JsonElementContentNode>() : undefined;
    const childOccurrences: Map<string, number> | undefined = config.includeOrderedContent ? new Map<string, number>() : undefined;

    for (const node of element.getContent()) {
        if (node instanceof XMLElement) {
            const childName: string = node.getName();
            const converted: JsonValue = elementToJsonValue(node, config);
            let bucket: Array<JsonValue> | undefined = childGroups.get(childName);
            if (!bucket) {
                bucket = new Array<JsonValue>();
                childGroups.set(childName, bucket);
            }
            bucket.push(converted);
            if (orderedContent && childOccurrences) {
                const occurrence: number = childOccurrences.get(childName) ?? 0;
                childOccurrences.set(childName, occurrence + 1);
                orderedContent.push({ kind: "element", name: childName, occurrence });
            }
            continue;
        }
        if (node instanceof TextNode) {
            textPieces.push(node.getValue());
            if (orderedContent) {
                orderedContent.push({ kind: "text", value: node.getValue() });
            }
            continue;
        }
        if (node instanceof CData) {
            cdataPieces.push(node.getValue());
            if (orderedContent) {
                orderedContent.push({ kind: "cdata", value: node.getValue() });
            }
            continue;
        }
        if (node instanceof XMLComment) {
            commentPieces.push(node.getValue());
            if (orderedContent) {
                orderedContent.push({ kind: "comment", value: node.getValue() });
            }
            continue;
        }
        if (node instanceof ProcessingInstruction) {
            const entry: JsonProcessingInstruction = { target: node.getTarget() };
            const data: string = node.getData();
            if (data && data.length > 0) {
                entry.data = data;
            }
            processingInstructions.push(entry);
            if (orderedContent) {
                orderedContent.push({ kind: "processingInstruction", target: node.getTarget(), data });
            }
        }
    }

    const hasChildElements: boolean = childGroups.size > 0;
    const concatenatedText: string = textPieces.join("");
    const hasSignificantText: boolean = textPieces.length > 0 && (!hasChildElements || textPieces.some((value: string) => value.trim().length > 0));
    const hasAttributes: boolean = attributes.length > 0;
    const hasCData: boolean = cdataPieces.length > 0;
    const hasComments: boolean = commentPieces.length > 0;
    const hasProcessing: boolean = processingInstructions.length > 0;

    if (!hasAttributes && !hasChildElements && !hasCData && !hasComments && !hasProcessing) {
        if (!hasSignificantText) {
            return "";
        }
        return concatenatedText;
    }

    if (!config.includeOrderedContent && !hasAttributes && !hasComments && !hasProcessing && !hasCData && !hasSignificantText && childGroups.size === 1) {
        const [childName, values] = [...childGroups.entries()][0];
        if (childName === deriveArrayItemName(element.getName())) {
            return values;
        }
    }

    const result: JsonElementObject = {};

    if (hasAttributes) {
        const attributeMap: Record<string, string> = {};
        for (const attribute of attributes) {
            attributeMap[attribute.getName()] = attribute.getValue();
        }
        result._attributes = attributeMap;
    }

    if (hasSignificantText) {
        result._text = concatenatedText;
    }

    if (hasCData) {
        result._cdata = cdataPieces.length === 1 ? cdataPieces[0] : cdataPieces;
    }

    if (hasComments) {
        result._comments = commentPieces.length === 1 ? commentPieces[0] : commentPieces;
    }

    if (hasProcessing) {
        result._processingInstructions = processingInstructions;
    }

    for (const [childName, values] of childGroups.entries()) {
        if (values.length === 1) {
            result[childName] = values[0];
        } else {
            result[childName] = values;
        }
    }

    if (orderedContent && orderedContent.length > 0) {
        const actualOrder: Array<string> = orderedContent.map((entry: JsonElementContentNode) => {
            if (entry.kind === "element") {
                return `element:${entry.name}:${entry.occurrence}`;
            }
            return entry.kind;
        });

        const fallbackOrder: Array<string> = new Array<string>();
        if (hasSignificantText) {
            fallbackOrder.push("text");
        }
        if (hasCData) {
            for (let index: number = 0; index < cdataPieces.length; index++) {
                fallbackOrder.push("cdata");
            }
        }
        if (hasComments) {
            for (let index: number = 0; index < commentPieces.length; index++) {
                fallbackOrder.push("comment");
            }
        }
        if (hasProcessing) {
            for (let index: number = 0; index < processingInstructions.length; index++) {
                fallbackOrder.push("processingInstruction");
            }
        }
        for (const [childName, values] of childGroups.entries()) {
            for (let index: number = 0; index < values.length; index++) {
                fallbackOrder.push(`element:${childName}:${index}`);
            }
        }

        const needsOrderedContent: boolean = actualOrder.length !== fallbackOrder.length || actualOrder.some((value: string, index: number) => value !== fallbackOrder[index]);
        if (needsOrderedContent) {
            result._content = orderedContent;
        }
    }

    if (!hasAttributes && !hasSignificantText && !hasCData && !hasComments && !hasProcessing && childGroups.size === 0) {
        return "";
    }

    return result;
}

function jsonDocumentToXmlDocument(jsonDoc: XmlJsonDocument): XMLDocument {
    const document: XMLDocument = new XMLDocument();

    if (jsonDoc.declaration) {
        const version: string = jsonDoc.declaration.version ?? "1.0";
        const encoding: string = jsonDoc.declaration.encoding ?? "utf-8";
        const declaration: XMLDeclaration = new XMLDeclaration(version, encoding, jsonDoc.declaration.standalone);
        document.setXmlDeclaration(declaration);
    }

    const prologNodes: Array<JsonPrologNode> = jsonDoc.prolog ?? [];
    for (const node of prologNodes) {
        if (!node.afterDoctype) {
            appendMiscNode(document, node);
        }
    }

    if (jsonDoc.doctype) {
        const publicId: string = jsonDoc.doctype.publicId ?? "";
        const systemId: string = jsonDoc.doctype.systemId ?? "";
        const docType: XMLDocumentType = new XMLDocumentType(jsonDoc.doctype.name, publicId, systemId);
        if (jsonDoc.doctype.internalSubset) {
            docType.setInternalSubset(jsonDoc.doctype.internalSubset);
        }
        document.setDocumentType(docType);
    }

    for (const node of prologNodes) {
        if (node.afterDoctype) {
            appendMiscNode(document, node);
        }
    }

    const root: XMLElement = jsonValueToElement(jsonDoc.rootName, jsonDoc.root, jsonDoc.rootName);
    document.setRoot(root);

    if (jsonDoc.epilog) {
        for (const node of jsonDoc.epilog) {
            appendMiscNode(document, node);
        }
    }

    return document;
}

function appendMiscNode(document: XMLDocument, node: JsonMiscNode): void {
    if (node.type === "comment") {
        document.addComment(new XMLComment(node.value));
    } else if (node.type === "processingInstruction") {
        const data: string = node.data ?? "";
        document.addProcessingInstruction(new ProcessingInstruction(node.target, data));
    } else {
        document.addTextNode(new TextNode(node.value));
    }
}

function simpleJsonObjectToXmlDocument(value: JsonValue, rootElementName: string): XMLDocument {
    const document: XMLDocument = new XMLDocument();
    const root: XMLElement = jsonValueToElement(rootElementName, value, rootElementName);
    document.setRoot(root);
    return document;
}

function inferRootElementNameFromSimpleJson(value: JsonValue): string | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }
    if (Array.isArray(value)) {
        return undefined;
    }
    if (typeof value !== "object") {
        return undefined;
    }

    const objectValue: JsonElementObject = value as JsonElementObject;
    const candidateKeys: Array<string> = Object.keys(objectValue).filter((key: string) => !RESERVED_KEYS.has(key));
    if (candidateKeys.length !== 1) {
        return undefined;
    }
    return candidateKeys[0];
}

function jsonValueToElement(name: string, value: JsonValue, contextName: string): XMLElement {
    const element: XMLElement = new XMLElement(name);

    if (value === null || value === undefined) {
        return element;
    }

    if (Array.isArray(value)) {
        const itemName: string = deriveArrayItemName(contextName);
        for (const item of value) {
            const child: XMLElement = jsonValueToElement(itemName, item, itemName);
            element.addElement(child);
        }
        if (value.length === 0) {
            element.addString("");
        }
        return element;
    }

    if (typeof value === "string") {
        if (value.length > 0) {
            element.addString(value);
        }
        return element;
    }

    if (typeof value === "number" || typeof value === "boolean") {
        element.addString(String(value));
        return element;
    }

    const objectValue: JsonElementObject = value;

    if (objectValue._attributes) {
        for (const [attrName, attrValue] of Object.entries(objectValue._attributes)) {
            if (attrValue === null || attrValue === undefined) {
                continue;
            }
            element.setAttribute(new XMLAttribute(attrName, String(attrValue)));
        }
    }

    if (objectValue._content && objectValue._content.length > 0) {
        appendOrderedContent(element, objectValue, objectValue._content);
        return element;
    }

    if (objectValue._text !== undefined && objectValue._text.length > 0) {
        element.addString(objectValue._text);
    }

    if (objectValue._cdata !== undefined) {
        const cdataValues: Array<string> = ensureArrayOfStrings(objectValue._cdata);
        for (const cdata of cdataValues) {
            element.addCData(new CData(cdata));
        }
    }

    if (objectValue._comments !== undefined) {
        const commentValues: Array<string> = ensureArrayOfStrings(objectValue._comments);
        for (const comment of commentValues) {
            element.addComment(new XMLComment(comment));
        }
    }

    if (objectValue._processingInstructions) {
        for (const pi of objectValue._processingInstructions) {
            const data: string = pi.data ?? "";
            element.addProcessingInstruction(new ProcessingInstruction(pi.target, data));
        }
    }

    for (const [childName, childValue] of Object.entries(objectValue)) {
        if (RESERVED_KEYS.has(childName)) {
            continue;
        }
        if (childValue === undefined) {
            continue;
        }
        if (Array.isArray(childValue)) {
            for (const entry of childValue as Array<JsonValue>) {
                const childElement: XMLElement = jsonValueToElement(childName, entry, childName);
                element.addElement(childElement);
            }
        } else {
            const childElement: XMLElement = jsonValueToElement(childName, childValue as JsonValue, childName);
            element.addElement(childElement);
        }
    }

    return element;
}

function appendOrderedContent(element: XMLElement, source: JsonElementObject, content: Array<JsonElementContentNode>): void {
    const childCache: Map<string, Array<JsonValue>> = new Map<string, Array<JsonValue>>();

    for (const entry of content) {
        switch (entry.kind) {
            case "text":
                element.addTextNode(new TextNode(entry.value));
                break;
            case "cdata":
                element.addCData(new CData(entry.value));
                break;
            case "comment":
                element.addComment(new XMLComment(entry.value));
                break;
            case "processingInstruction": {
                const data: string = entry.data ?? "";
                element.addProcessingInstruction(new ProcessingInstruction(entry.target, data));
                break;
            }
            case "element": {
                const values: Array<JsonValue> = getChildValues(source, entry.name, childCache);
                const jsonValue: JsonValue | undefined = values[entry.occurrence];
                if (jsonValue === undefined) {
                    break;
                }
                const childElement: XMLElement = jsonValueToElement(entry.name, jsonValue, entry.name);
                element.addElement(childElement);
                break;
            }
        }
    }
}

function getChildValues(source: JsonElementObject, childName: string, cache: Map<string, Array<JsonValue>>): Array<JsonValue> {
    let values: Array<JsonValue> | undefined = cache.get(childName);
    if (!values) {
        const rawValue: JsonValue | Array<JsonValue> | string | Array<string> | Array<JsonProcessingInstruction> | Record<string, string | number | boolean | null> | Array<JsonElementContentNode> | undefined = source[childName];
        if (rawValue === undefined) {
            values = [];
        } else if (Array.isArray(rawValue)) {
            if (rawValue.length > 0 && typeof rawValue[0] === "object" && rawValue[0] !== null && "kind" in (rawValue[0] as Record<string, unknown>)) {
                values = [];
            } else {
                values = rawValue as Array<JsonValue>;
            }
        } else {
            values = [rawValue as JsonValue];
        }
        cache.set(childName, values);
    }
    return values;
}

function ensureArrayOfStrings(value: string | Array<string>): Array<string> {
    return Array.isArray(value) ? value : [value];
}

function deriveArrayItemName(parentName: string): string {
    if (parentName.length > 3 && parentName.endsWith("ies")) {
        return parentName.substring(0, parentName.length - 3) + "y";
    }
    if (parentName.length > 1 && parentName.endsWith("s")) {
        return parentName.substring(0, parentName.length - 1);
    }
    return "item";
}

function isXmlJsonDocument(value: unknown): value is XmlJsonDocument {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate: Record<string, unknown> = value as Record<string, unknown>;
    return typeof candidate.rootName === "string" && candidate.root !== undefined;
}

async function readStreamToString(stream: Readable, encoding: BufferEncoding): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const chunks: Array<string> = new Array<string>();
        stream.setEncoding(encoding);
        stream.on("data", (chunk: string) => {
            chunks.push(chunk);
        });
        stream.once("error", reject);
        stream.once("end", () => {
            resolve(chunks.join(""));
        });
    });
}
