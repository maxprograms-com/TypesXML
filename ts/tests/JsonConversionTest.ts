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

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { DOMBuilder } from "../DOMBuilder.js";
import { SAXParser } from "../SAXParser.js";
import { XMLDocument } from "../XMLDocument.js";
import {
    JsonElementObject,
    JsonValue,
    XmlJsonDocument,
    jsonFileToXmlFile,
    jsonObjectToXmlDocument,
    jsonObjectToXmlFile,
    jsonStreamToXmlDocument,
    xmlDocumentToJsonObject,
    xmlFileToJsonFile,
    xmlStreamToJsonObject,
    xmlStringToJsonFile,
    xmlStringToJsonObject
} from "../json/JsonConversion.js";

async function runJsonConversionTests(): Promise<void> {
    const samples: Array<string> = [
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<!--Before root--><!--Second comment-->' +
        '<!DOCTYPE note [' +
        '<!ENTITY writer "John Doe">' +
        '<!ELEMENT note ANY>' +
        '<!ELEMENT body ANY>' +
        '<!ELEMENT h:header ANY>' +
        '<!ELEMENT child ANY>' +
        '<!ELEMENT empty EMPTY>' +
        ']>' +
        '<note xmlns:h="http://example.com/h" category="memo">' +
        '<h:header><![CDATA[Agenda]]></h:header>' +
        '<body>Don\'t forget &writer; on Monday<?pi instructions?></body>' +
        '<empty />' +
        '</note>',
        '<?xml version="1.1" encoding="UTF-8" standalone="yes"?>\n' +
        '<root attr1="value1" attr2="value2">' +
        'Text node<child>Inner</child>' +
        '<child xml:lang="en">More text</child>' +
        '<![CDATA[raw <content>]]>' +
        '<?processing data?>' +
        '<!--After content-->' +
        '</root>'
    ];

    for (let index: number = 0; index < samples.length; index++) {
        const label: string = `Sample ${index + 1}`;
        await assertStructuredRoundTrip(samples[index], label);
    }

    await assertRepeatedChildContainerRoundTrip();
    await assertPlainObjectRoundTrip();
        await assertRootInference();
    await assertFileConversions(samples[0]);
    await assertStreamConversions(samples[1]);

    console.log("JSON conversion tests passed.");
}

async function assertStructuredRoundTrip(xmlText: string, label: string): Promise<void> {
    const originalDocument: XMLDocument = parseXml(xmlText);
    const simpleJson: JsonValue = xmlStringToJsonObject(xmlText);
    if (typeof simpleJson !== "object" || simpleJson === null || Array.isArray(simpleJson)) {
        throw new Error(`Expected simple conversion to yield object JSON for ${label}`);
    }
    if ("rootName" in simpleJson || "prolog" in simpleJson || "doctype" in simpleJson) {
        throw new Error(`Simple conversion leaked document metadata for ${label}`);
    }

    const jsonDocument: XmlJsonDocument = xmlStringToJsonObject(xmlText, { mode: "roundtrip" });

    if (jsonDocument.rootName !== originalDocument.getRoot()?.getName()) {
        throw new Error(`Root name mismatch for ${label}`);
    }

    const rebuiltDocument: XMLDocument = jsonObjectToXmlDocument(jsonDocument);
    if (!originalDocument.equals(rebuiltDocument)) {
        throw new Error(`XML -> JSON -> XML comparison failed for ${label}`);
    }

    if (jsonDocument.prolog && jsonDocument.prolog.length === 0) {
        throw new Error(`Expected prolog entries for ${label}`);
    }

    if (jsonDocument.declaration && jsonDocument.declaration.version === undefined) {
        throw new Error(`Missing declaration details for ${label}`);
    }
}

async function assertRepeatedChildContainerRoundTrip(): Promise<void> {
    const xmlText: string = "<root><wrapper><item>x</item><item>y</item></wrapper></root>";
    const originalDocument: XMLDocument = parseXml(xmlText);
    const jsonDocument: XmlJsonDocument = xmlStringToJsonObject(xmlText, { mode: "roundtrip" });
    const rebuiltDocument: XMLDocument = jsonObjectToXmlDocument(jsonDocument);

    if (!originalDocument.equals(rebuiltDocument)) {
        throw new Error("Repeated child container round-trip failed");
    }
}

async function assertPlainObjectRoundTrip(): Promise<void> {
    const source: JsonValue = {
        library: "painters",
        books: ["DaVinci", "VanGogh", "Rubens"],
        prices: [13000, 5000, 20000]
    };

    const document: XMLDocument = jsonObjectToXmlDocument(source, "libraryCatalog");
    const simpleRoundTrip: JsonValue = xmlDocumentToJsonObject(document);
    if (typeof simpleRoundTrip !== "object" || simpleRoundTrip === null || Array.isArray(simpleRoundTrip)) {
        throw new Error("Simple round-trip should yield an object");
    }
    if ("rootName" in simpleRoundTrip) {
        throw new Error("Simple round-trip should not include root metadata");
    }

    const roundTrip: XmlJsonDocument = xmlDocumentToJsonObject(document, { mode: "roundtrip" });
    const root: JsonElementObject | JsonValue[] | string | number | boolean | null = roundTrip.root;

    if (!root || Array.isArray(root) || typeof root !== "object") {
        throw new Error("Unexpected JSON structure for plain object round-trip");
    }

    const rootObject: JsonElementObject = root as JsonElementObject;
    if (rootObject.library !== "painters") {
        throw new Error("Library value mismatch after round-trip");
    }

    const booksEntry = rootObject.books;
    if (!Array.isArray(booksEntry) || booksEntry.some((item) => typeof item !== "string") || booksEntry.length !== 3) {
        throw new Error("Books array mismatch after round-trip");
    }

    const pricesEntry = rootObject.prices;
    if (!Array.isArray(pricesEntry) || pricesEntry.some((entry) => typeof entry !== "string")) {
        throw new Error("Prices array expected string representations");
    }
}

async function assertRootInference(): Promise<void> {
    const source: JsonValue = {
        library: {
            books: ["DaVinci", "VanGogh", "Rubens"]
        }
    };

    const document: XMLDocument = jsonObjectToXmlDocument(source);
    const root = document.getRoot();
    if (!root || root.getName() !== "library") {
        throw new Error("Expected root element name to be inferred from single property");
    }

    const roundTripJson: JsonValue = xmlDocumentToJsonObject(document);
    if (typeof roundTripJson !== "object" || roundTripJson === null || Array.isArray(roundTripJson)) {
        throw new Error("Round-tripped JSON should remain an object");
    }
    if (!("library" in roundTripJson)) {
        throw new Error("Round-tripped JSON missing inferred property");
    }
}

async function assertFileConversions(xmlText: string): Promise<void> {
    const tempDir: string = mkdtempSync(join(tmpdir(), "typesxml-json-files-"));
    const xmlInputPath: string = join(tempDir, "input.xml");
    writeFileSync(xmlInputPath, xmlText, "utf8");

    const jsonPath: string = join(tempDir, "output.json");
    await xmlFileToJsonFile(xmlInputPath, jsonPath, "utf8", 2, "utf8", { mode: "roundtrip" });
    const parsedJson: XmlJsonDocument = JSON.parse(readFileSync(jsonPath, "utf8")) as XmlJsonDocument;

    const rebuiltDocument: XMLDocument = jsonObjectToXmlDocument(parsedJson);
    const originalDocument: XMLDocument = parseXml(xmlText);
    if (!originalDocument.equals(rebuiltDocument)) {
        throw new Error("File-based XML -> JSON -> XML comparison failed");
    }

    const rebuiltXmlPath: string = join(tempDir, "roundtrip.xml");
    await jsonFileToXmlFile(jsonPath, rebuiltXmlPath);
    const roundTripDocument: XMLDocument = parseXml(readFileSync(rebuiltXmlPath, "utf8"));
    if (!originalDocument.equals(roundTripDocument)) {
        throw new Error("JSON file -> XML file comparison failed");
    }

    const jsonStringPath: string = join(tempDir, "string.json");
    await xmlStringToJsonFile(xmlText, jsonStringPath, { mode: "roundtrip" });
    const jsonDocument: XmlJsonDocument = JSON.parse(readFileSync(jsonStringPath, "utf8")) as XmlJsonDocument;
    await jsonObjectToXmlFile(jsonDocument, join(tempDir, "from-string.xml"));

    rmSync(tempDir, { recursive: true, force: true });
}

async function assertStreamConversions(xmlText: string): Promise<void> {
    const xmlDocument: XMLDocument = parseXml(xmlText);
    const xmlStream: Readable = Readable.from([xmlText]);
    const jsonFromStream: XmlJsonDocument = await xmlStreamToJsonObject(xmlStream, { mode: "roundtrip" });
    const rebuiltFromStream: XMLDocument = jsonObjectToXmlDocument(jsonFromStream);
    if (!xmlDocument.equals(rebuiltFromStream)) {
        throw new Error("XML stream round-trip failed");
    }

    const jsonText: string = JSON.stringify(jsonFromStream);
    const jsonStream: Readable = Readable.from([jsonText]);
    const documentFromJsonStream: XMLDocument = await jsonStreamToXmlDocument(jsonStream);
    if (!xmlDocument.equals(documentFromJsonStream)) {
        throw new Error("JSON stream round-trip failed");
    }
}

function parseXml(xmlText: string): XMLDocument {
    const parser: SAXParser = new SAXParser();
    const builder: DOMBuilder = new DOMBuilder();
    builder.initialize();
    parser.setContentHandler(builder);
    parser.setValidating(false);
    parser.parseString(xmlText);
    const document: XMLDocument | undefined = builder.getDocument();
    if (!document) {
        throw new Error("Unable to parse XML text");
    }
    return document;
}

runJsonConversionTests().catch((error: unknown) => {
    console.error("JSON conversion tests failed:", error);
    process.exitCode = 1;
});
