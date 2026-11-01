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

import { CData } from "./CData.js";
import { Catalog } from "./Catalog.js";
import { ContentHandler } from "./ContentHandler.js";
import { ProcessingInstruction } from "./ProcessingInstruction.js";
import { TextNode } from "./TextNode.js";
import { XMLAttribute } from "./XMLAttribute.js";
import { XMLComment } from "./XMLComment.js";
import { XMLDeclaration } from "./XMLDeclaration.js";
import { XMLDocument } from "./XMLDocument.js";
import { XMLDocumentType } from "./XMLDocumentType.js";
import { XMLElement } from "./XMLElement.js";
import { XMLUtils } from "./XMLUtils.js";
import { DTDParser } from "./dtd/DTDParser.js";
import { DTDGrammar } from "./dtd/DTDGrammar.js";
import { Grammar } from "./grammar/Grammar.js";
import { GrammarCache } from "./grammar/GrammarCache.js";

export class DOMBuilder implements ContentHandler {

    inCdData: boolean = false;
    currentCData: CData = new CData('');
    document: XMLDocument | undefined;
    stack: Array<XMLElement> = [];
    catalog: Catalog | undefined;
    dtdParser: DTDParser | undefined;
    grammar: Grammar | undefined;
    grammarCache: GrammarCache | undefined;

    initialize(): void {
        this.document = new XMLDocument();
        this.stack = new Array();
        this.inCdData = false;
    }

    setGrammar(grammar: Grammar | undefined): void {
        this.grammar = grammar;
        if (grammar instanceof DTDGrammar) {
            if (!this.dtdParser) {
                this.dtdParser = new DTDParser(grammar);
            } else {
                this.dtdParser.setGrammar(grammar);
            }
        }
    }

    setCatalog(catalog: Catalog): void {
        this.catalog = catalog;
    }

    setGrammarCache(cache: GrammarCache | undefined): void {
        this.grammarCache = cache;
    }

    getDocument(): XMLDocument | undefined {
        return this.document;
    }

    startDocument(): void {
        // do nothing
    }

    endDocument(): void {
        // do nothing
    }

    xmlDeclaration(version: string, encoding: string, standalone: string): void {
        let xmlDclaration = new XMLDeclaration(version, encoding, standalone);
        this.document?.setXmlDeclaration(xmlDclaration);
    }

    startElement(name: string, atts: XMLAttribute[]): void {
        let element: XMLElement = new XMLElement(name);
        atts.forEach((att) => {
            element.setAttribute(att);
        });
        if (this.stack.length > 0) {
            this.stack[this.stack.length - 1].addElement(element);
        } else {
            this.document?.setRoot(element);
        }
        this.stack.push(element);
    }

    endElement(name: string): void {
        this.stack.pop();
    }

    getCurrentText(): string {
        if (this.stack.length > 0) {
            return this.stack[this.stack.length - 1].pureText();
        }
        return '';
    }

    internalSubset(declaration: string): void {
        let docType: XMLDocumentType | undefined = this.document?.getDocumentType();
        if (docType) {
            docType.setInternalSubset(declaration);
        }
    }

    characters(ch: string): void {
        if (this.inCdData) {
            this.currentCData.setValue(this.currentCData.getValue() + ch);
            return;
        }
        let textNode: TextNode = new TextNode(ch);
        if (this.stack.length > 0) {
            this.stack[this.stack.length - 1].addTextNode(textNode);
        } else {
            this.document?.addTextNode(textNode);
        }
    }

    ignorableWhitespace(ch: string): void {
        let textNode: TextNode = new TextNode(ch);
        if (this.stack.length > 0) {
            this.stack[this.stack.length - 1].addTextNode(textNode);
        } else {
            this.document?.addTextNode(textNode);
        }
    }

    comment(ch: string): void {
        let comment: XMLComment = new XMLComment(ch);
        if (this.stack.length > 0) {
            this.stack[this.stack.length - 1].addComment(comment);
        } else {
            this.document?.addComment(comment);
        }
    }

    processingInstruction(target: string, data: string): void {
        let pi = new ProcessingInstruction(target, data);
        if (this.stack.length > 0) {
            this.stack[this.stack.length - 1].addProcessingInstruction(pi);
        } else {
            this.document?.addProcessingInstruction(pi);
        }
    }

    parseXmlModel(text: string): Map<string, string> {
        let map = new Map<string, string>();
        let pairs: string[] = [];
        let separator: string = '';
        while (text.indexOf('=') != -1) {
            let i: number = 0;
            for (; i < text.length; i++) {
                let char = text[i];
                if (XMLUtils.isXmlSpace(char) || '=' === char) {
                    break;
                }
            }
            for (; i < text.length; i++) {
                let char = text[i];
                if (separator === '' && ('\'' === char || '"' === char)) {
                    separator = char;
                    continue;
                }
                if (char === separator) {
                    break;
                }
            }
            // end of value
            let pair = text.substring(0, i + 1).trim();
            pairs.push(pair);
            text = text.substring(pair.length).trim();
            separator = '';
        }
        pairs.forEach((pair: string) => {
            let index = pair.indexOf('=');
            if (index === -1) {
                throw new Error('Malformed attributes list');
            }
            let name = pair.substring(0, index).trim();
            let value = pair.substring(index + 2, pair.length - 1);
            map.set(name, value);
        });
        return map;
    }

    startCDATA(): void {
        this.currentCData = new CData('');
        this.inCdData = true;
    }

    endCDATA(): void {
        if (this.stack.length > 0) {
            this.stack[this.stack.length - 1].addCData(this.currentCData);
        } else {
            throw new Error("CData section outside of root element");
        }
        this.inCdData = false;
    }

    startDTD(name: string, publicId: string, systemId: string): void {
        let docType: XMLDocumentType = new XMLDocumentType(name, publicId, systemId);
        this.document?.setDocumentType(docType);
        if (this.catalog) {
            const url = this.catalog.resolveEntity(publicId, systemId);
            if (url) {
                const cachedGrammar: Grammar | undefined = this.grammarCache?.get(url);
                if (cachedGrammar !== undefined) {
                    this.setGrammar(cachedGrammar);
                    return;
                }
                if (!this.dtdParser) {
                    this.dtdParser = new DTDParser();
                }
                const dtdGrammar: DTDGrammar = this.dtdParser.parseDTD(url);
                this.setGrammar(dtdGrammar);
                this.grammarCache?.put(url, dtdGrammar);
            }
        }
    }

    endDTD(): void {
        // do nothing
    }

    getGrammar(): Grammar | undefined {
        return this.grammar;
    }

    skippedEntity(name: string): void {
        const replacement: string | undefined = this.grammar?.resolveEntity(name);
        if (replacement && replacement.length > 0) {
            this.characters(replacement);
            return;
        }

        if (this.grammar instanceof DTDGrammar) {
            const entityDecl = this.grammar.getEntity(name);
            if (entityDecl && entityDecl.isExternal() && this.dtdParser) {
                try {
                    const externalText = this.dtdParser.loadExternalEntity(entityDecl.getPublicId(), entityDecl.getSystemId(), true);
                    if (externalText.length > 0) {
                        entityDecl.setValue(externalText);
                        this.characters(externalText);
                        return;
                    }
                } catch (error) {
                    throw new Error(`Could not resolve external entity "${name}": ${(error as Error).message}`);
                }
            }
        }

        // Preserve the reference if no replacement text is available
        this.characters('&' + name + ';');
    }
}