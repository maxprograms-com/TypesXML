# TypesXML Tutorial

This tutorial walks through the most common workflows for the TypesXML toolkit. Each section builds on the previous one so you can quickly wire the parser into a TypeScript or Node.js project. If you need to move between XML and JSON, pair this guide with the dedicated [JSON and XML Conversion Guide](jsonTutorial.md).

For a feature overview see the [project README](../README.md), and download the runnable snippets described here from the [`samples/` guide](../samples/README.md).

## 1. Installation

Install the package from npm:

```bash
npm install typesxml
```

TypesXML ships TypeScript declaration files, so you get full intellisense in editors that understand TypeScript.

### Grab the Ready-Made Samples

If you want to jump straight to a working project, download the `samples/` folder from the repository (or clone the repo and `cd samples`). Then install the dependencies and run any script with Node:

```bash
npm install
npm run parse-file
```

Each npm script runs `tsc -p tsconfig.json` and then invokes the emitted file from `dist/`, so the workflow matches a typical NodeNext project build without installing extra tooling. The folder includes a `resources/` directory with the XML catalog, schema, and sample document used throughout this guide.

## 2. Parsing Your First XML File

```ts
import { DOMBuilder, SAXParser } from "typesxml";

// DOMBuilder captures a DOM tree while the SAX parser walks the document stream.
const handler = new DOMBuilder();
const parser = new SAXParser();
parser.setContentHandler(handler);

parser.parseFile("samples/resources/xml/library-valid.xml"); // Use "resources/..." inside the samples folder.

const document = handler.getDocument();
console.log(document?.toString());
```

`parseFile` accepts absolute or relative paths. After parsing, `DOMBuilder` exposes an `XMLDocument` tree that you can traverse or serialise. The repository ships a ready-to-use sample at `samples/resources/xml/library.xml` (or `resources/xml/library.xml` inside the standalone `samples/` folder) so you can experiment immediately.

## 3. Traversing the DOM

Once you have an `XMLDocument`, you can walk the tree to inspect element names, attributes, and text content.

```ts
import { DOMBuilder, SAXParser, XMLElement } from "typesxml";

const handler = new DOMBuilder();
const parser = new SAXParser();
parser.setContentHandler(handler);
parser.parseFile("samples/resources/xml/library.xml"); // Use "resources/..." inside the samples folder.

const document = handler.getDocument();
if (!document) {
    throw new Error("Document unavailable");
}

const root: XMLElement | undefined = document.getRoot();
if (!root) {
    throw new Error("Root element missing");
}

// Count child elements and inspect their attributes/text.
console.log("Book count:", root.getChildren().length);
root.getChildren().forEach((book) => {
    const isbn = book.getAttribute("isbn")?.getValue();
    const title = book.getChild("title")?.getText().trim();
    console.log(`Book ${isbn}: ${title}`);
});

// Quickly locate the first matching descendant.
const firstBook = root.getChild("book");
if (firstBook) {
    console.log("First book author:", firstBook.getChild("author")?.getText().trim());
}
```

Key DOM helpers:

- `XMLDocument#getRoot()` returns the outermost element.
- `XMLElement#getChildren()` filters only element nodes from the mixed content array.
- `XMLElement#getAttribute(name)` retrieves an `XMLAttribute`, and `#getText()` returns concatenated descendant text.

## 4. Working with OASIS XML Catalogs

An **OASIS XML Catalog** is a lookup table that maps public identifiers, system identifiers, or URIs to local resources. Catalogs let you resolve external entities and schemas without hard-coding network locations—perfect for offline operation or controlled dependency management.

```ts
import { Catalog, DOMBuilder, SAXParser } from "typesxml";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sampleDir = fileURLToPath(new URL(".", import.meta.url));
const catalogPath = resolve(sampleDir, "resources/catalog/catalog.xml");
const catalog = new Catalog(catalogPath);

const handler = new DOMBuilder();
const parser = new SAXParser();
parser.setCatalog(catalog); // Enables catalog-based resolution.
parser.setContentHandler(handler);
parser.parseFile("samples/resources/xml/library.xml"); // Use "resources/..." inside the samples folder.

`Catalog` requires an absolute file system path. The snippet above anchors the lookup to the sample’s directory via `import.meta.url`, but any approach that produces an absolute path (for example `resolve(process.cwd(), "catalog/catalog.xml")`) works in your own projects.
```

The parser now resolves DTDs through the catalog and can locate RelaxNG or XML Schema documents to harvest default attributes, avoiding repetitive HTTP requests and ensuring consistent versions.

## 5. Enabling Validating Mode

Validation checks the document against its DTD or XML Schema and raises an error when a rule is violated. It does not influence default attribute retrieval — RelaxNG and XML Schema grammars are loaded for defaults whenever they are referenced. The samples folder includes `resources/dtd/sample.dtd` plus matching XML instances so you can see both success and failure cases.

```ts
const parser = new SAXParser();
parser.setValidating(true); // Switches on DTD and XML Schema 1.0 validation.
parser.setContentHandler(handler);

try {
    parser.parseFile("samples/resources/xml/library-valid.xml"); // Use "resources/..." inside the samples folder.
    console.log("Validation passed");
} catch (error) {
    console.error("Validation failed", error);
}
```

Swap the path to `library-invalid.xml` to trigger a validation error (missing the required `isbn` attribute) and inspect the thrown message.

When running the bundled samples, use `npm run catalog-validated -- dtd` for the valid DTD case or `npm run catalog-validated -- invalid` to see the failure in action. The default `npm run catalog-validated` command sticks with the schema-backed example to highlight merged defaults.

## 6. Parsing from a String

```ts
import { DOMBuilder, SAXParser } from "typesxml";

const xml = `<greeting>Hello <name>World</name></greeting>`;
const handler = new DOMBuilder();
const parser = new SAXParser();
parser.setContentHandler(handler);

parser.parseString(xml);
console.log(handler.getDocument()?.toString());
```

`parseString` is useful for unit tests and situations where XML is generated on the fly.

## 7. Parsing from a Stream

Streams let you process remote documents incrementally. In this quick example we still hand events to a `DOMBuilder`, which materialises the final tree in memory—great for payloads that comfortably fit in RAM (even if they are not tiny) and when you want full DOM access at the end of the parse.

```ts
import { DOMBuilder, SAXParser } from "typesxml";
import { request } from "node:https";

const handler = new DOMBuilder();
const parser = new SAXParser();
parser.setContentHandler(handler);

request("https://example.com/feed.xml", (response) => {
    parser.parseStream(response)
        .then(() => {
            console.log("Feed parsed:", handler.getDocument()?.getRoot()?.getName());
        })
        .catch((error) => {
            console.error("Parsing failed", error);
        });
}).end();
```

`parseStream` returns a promise that resolves when the stream ends. TypesXML normalises partial chunks and back-pressure automatically.

When you truly need to keep memory usage flat (for example, parsing multi-gigabyte feeds or piping to another system), implement a bespoke `ContentHandler` instead of `DOMBuilder` so you can react to SAX events as they arrive without retaining the entire document.

## 8. Writing a Custom Content Handler

Implement `ContentHandler` when you want to respond to SAX events without building a DOM tree—for example, to index elements or transform data on the fly.

```ts
import { SAXParser } from "typesxml";
import type { Catalog, ContentHandler, Grammar, XMLAttribute } from "typesxml";

class LoggingHandler implements ContentHandler {
    initialize(): void { /* No setup needed. */ }
    setCatalog(_catalog: Catalog): void { /* Catalog not required for logging. */ }
    setGrammar(_grammar: Grammar | undefined): void { /* Grammars not cached for this handler. */ }
    getGrammar(): Grammar | undefined { return undefined; }
    getCurrentText(): string { return ''; }
    startDocument(): void { console.log("Start document"); }
    endDocument(): void { console.log("End document"); }
    xmlDeclaration(version: string, encoding: string, standalone: string | undefined): void {
        console.log(`XML declaration v${version} (${encoding}) standalone=${standalone}`);
    }
    startElement(name: string, atts: XMLAttribute[]): void {
        const attrSummary = atts.map((att) => `${att.getName()}="${att.getValue()}"`).join(" ");
        console.log(`<${name}${attrSummary ? " " + attrSummary : ""}>`);
    }
    endElement(name: string): void {
        console.log(`</${name}>`);
    }
    internalSubset(declaration: string): void {
        if (declaration.trim()) {
            console.log(`<![INTERNAL SUBSET ${declaration}]>`);
        }
    }
    characters(text: string): void {
        const collapsed = text.trim();
        if (collapsed) {
            console.log(`TEXT: ${collapsed}`);
        }
    }
    ignorableWhitespace(text: string): void {
        if (text.length > 0) {
            console.log(`WHITESPACE(${text.length})`);
        }
    }
    comment(text: string): void { console.log(`<!-- ${text} -->`); }
    processingInstruction(target: string, data: string): void {
        console.log(`<?${target} ${data}?>`);
    }
    startCDATA(): void { console.log("<![CDATA["); }
    endCDATA(): void { console.log("]]>"); }
    startDTD(name: string, publicId: string, systemId: string): void {
        console.log(`<!DOCTYPE ${name} PUBLIC "${publicId}" "${systemId}">`);
    }
    endDTD(): void { /* No-op for this handler. */ }
    skippedEntity(name: string): void {
        console.warn(`Skipped entity: ${name}`);
    }
}

const parser = new SAXParser();
parser.setContentHandler(new LoggingHandler());
parser.parseFile("samples/resources/xml/library.xml"); // Use "resources/..." inside the samples folder.
```

Only implement the callbacks you care about—unimplemented methods can remain empty.

## 9. Merging Default Attributes from Grammars

TypesXML collects default attribute values declared in any grammar it can load (DTD, RelaxNG, or XML Schema) and merges them into SAX events. That means elements automatically receive attributes such as `translate="yes"` or `class="- map/map"` without you manually copying values. DTD defaults participate in the same way as schema-driven defaults.

To benefit from this feature:

1. Supply an OASIS catalog that resolves schema references (or otherwise ensure the grammars are reachable).
2. Enable validation (`parser.setValidating(true)`) only if you need DTD or XML Schema 1.0 enforcement; default attributes are merged regardless.

You will then see the defaults in DOM output and SAX callbacks.

The sample command `npm run relaxng-defaults` demonstrates this with a RelaxNG grammar resolved through the catalog: the parser pulls default attributes from `library-rng.xml` even though validation remains disabled.

### Caching grammars across documents

Parsing a grammar takes time. When you process many documents that reference the same DTD, XML Schema, or RelaxNG grammar, hand the parser a `GrammarCache` so each grammar is parsed only once:

```ts
import { DOMBuilder, GrammarCache, SAXParser } from "typesxml";

const cache = new GrammarCache();
for (const file of files) {
    const handler = new DOMBuilder();
    const parser = new SAXParser();
    parser.setContentHandler(handler);
    parser.setCatalog(catalog);
    parser.setGrammarCache(cache);
    parser.parseFile(file);
}
```

The cache is keyed by the resolved grammar URL, so documents using different grammars can share one cache. `GrammarCache.get` returns a copy of the cached grammar, which keeps document-specific declarations (for example an internal DTD subset) from leaking into the cached grammar used by the next document. Create one cache per batch run and discard it when the run ends.

## 10. Error Handling and Diagnostics

Wrap parsing calls with `try/catch` or use the promise returned by `parseStream` to intercept errors. For debugging, inspect the parser’s diagnostic maps:

```ts
console.log("Schemas processed:", Array.from(parser.processedSchemaLocations));
console.log("Namespaces processed:", Array.from(parser.processedNamespaces));
console.log("Schemas that failed:", Array.from(parser.failedSchemaLocations));
```

These collections help you confirm which schemas were loaded and where defaults originated.

## 11. Next Steps

- Combine `SAXParser` with your application’s data model by creating specialised handlers.
- Use `DOMBuilder` for modification-heavy workflows, then serialise with `XMLDocument#toString()`.
- Explore the source in `ts/` for advanced utilities such as indentation helpers, writers, and RelaxNG support.
- Download the `samples/` folder, run `npm install`, and execute `npm run parse-file` to test everything with Node immediately.
- Browse the runnable snippets under `samples/` for end-to-end code you can adapt.

TypesXML is designed for modular extension—mix and match DOM, SAX, catalog resolution, and schema defaults to suit your application.
