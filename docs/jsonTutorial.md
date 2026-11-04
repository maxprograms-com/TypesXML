# JSON and XML Conversion Guide

This tutorial covers the TypesXML conversion functions that move between XML documents and JSON objects. Each section shows a focused task so you can apply the API immediately. The conversion functions support two modes: “simple” (default) returns only element content, while “roundtrip” retains metadata such as declarations and DOCTYPE nodes. The XML→JSON section describes both modes with examples. For parser setup, DOM traversal, and SAX handling basics, read the companion [TypesXML Tutorial](tutorial.md).

## Function overview

- `jsonObjectToXmlDocument(data, rootName?)`: Create an `XMLDocument` from JSON. When you omit `rootName`, the converter uses the name of the single top-level property as the root element, and that property is still written as a child of it; if there is not exactly one top-level property, the root is `<json>`.
- `xmlStringToJsonObject(xml, options?)`: Convert an XML string to JSON. Set `options.mode` to `"roundtrip"` when you need the metadata described in the XML→JSON section.
- `xmlFileToJsonObject(path, options?)` and `xmlStreamToJsonObject(stream, options?)`: Stream or load XML and receive JSON. Options mirror the string variant.
- `jsonObjectToXmlFile(data, target, rootName?)`, `jsonFileToXmlDocument`, and `jsonStreamToXmlDocument`: Write or parse XML using the same JSON shape.

Use the sections below to see these functions in action and understand the JSON structure they read and produce.

## JSON → XML

The JSON conversion functions accept plain objects, arrays, and primitive values. Arrays become repeated child elements and objects become nested elements. Ordinary payloads work without extra properties. Use the optional helper keys (`_attributes`, `_text`, and the others listed later) only when you need to represent XML constructs such as attributes, CDATA blocks, comments, or processing instructions. The optional second argument to `jsonObjectToXmlDocument` supplies the root element name. Omit it to use `<json>…</json>`, or rely on the automatic name picked from a single top-level property. When you pass the structure returned by the XML→JSON conversion (documented later as `XmlJsonDocument`), the converter ignores the second argument and reuses the stored `rootName`.

```ts
import { Indenter, XMLDocument, jsonObjectToXmlDocument } from "typesxml";

function main(): void {
  const data: any = {
    library: "painters",
    books: { book: ["DaVinci", "VanGogh", "Rubens"] },
    prices: { price: [13000, 5000, 20000] }
  };

  const document: XMLDocument = jsonObjectToXmlDocument(data, "libraryCatalog");
  new Indenter(2).indent(document.getRoot()!);
  console.log(document.toString());
}

main();
```

Output:

```xml
<libraryCatalog>
  <library>painters</library>
  <books>
    <book>DaVinci</book>
    <book>VanGogh</book>
    <book>Rubens</book>
  </books>
  <prices>
    <price>13000</price>
    <price>5000</price>
    <price>20000</price>
  </prices>
</libraryCatalog>
```

### Attributes, comments, and CDATA

Use reserved keys to add extra XML constructs:

- `_attributes`: record of attribute names and values.
- `_text`: literal text node content.
- `_cdata`: string or array of strings wrapped in CDATA blocks.
- `_comments`: comment text (string or array of strings).
- `_processingInstructions`: array of `{ target, data? }` entries.

```ts
const product: any = {
  _attributes: { sku: "ABC-01" },
  name: "Wireless Headphones",
  description: {
    _cdata: "Crystal clear sound & noise cancellation"
  },
  notes: {
    _comments: "Internal documentation only",
    _processingInstructions: [{ target: "style", data: "bold" }],
    note: "Read the manual before use"
  }
};

const document = jsonObjectToXmlDocument(product, "product");
new Indenter(2).indent(document.getRoot()!);
console.log(document.toString());
```

```xml
<product sku="ABC-01">
  <name>Wireless Headphones</name>
  <description>
    <![CDATA[Crystal clear sound & noise cancellation]]>
  </description>
  <notes>
    <!--Internal documentation only-->
    <?style bold?>
    <note>Read the manual before use</note>
  </notes>
</product>
```

## XML → JSON

The XML conversion functions offer two modes. The default “simple” mode strips away document-level metadata and returns only the element content as standard JSON. When you need lossless round-tripping, enable the “roundtrip” mode to capture declarations, DOCTYPE information, prolog/epilog nodes, and the precise ordering of mixed content.

### Simple conversion (default)

Simple mode is usually enough when you only need to round-trip the element structure and attribute values. It keeps the payload compact and still converts back to the same XML content, as long as document-level metadata or mixed-content ordering is not significant for your workflow.

```ts
import { xmlStringToJsonObject } from "typesxml";

const xml: string = [
  "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
  "<!--Before root-->",
  "<libraryCatalog>",
  "  <library category=\"memo\">painters</library>",
  "  <book>DaVinci</book>",
  "  <book>VanGogh</book>",
  "  <book>Rubens</book>",
  "</libraryCatalog>"
].join("\n");

const json: any = xmlStringToJsonObject(xml);
console.log(JSON.stringify(json, null, 2));
```

Output:

```json
{
  "library": {
    "_attributes": {
      "category": "memo"
    },
    "_text": "painters"
  },
  "book": [
    "DaVinci",
    "VanGogh",
    "Rubens"
  ]
}
```

Simple mode omits the XML declaration, DOCTYPE, and the root element name. Provide the root name yourself when converting back to XML. If the JSON object has exactly one top-level property, the converter uses that key automatically; otherwise call `jsonObjectToXmlDocument(json, "libraryCatalog")` (or whichever name matches your document).

### Round-trip mode

When lossless reconstruction is required, call the function with `mode: "roundtrip"`. The return value follows the `XmlJsonDocument` shape, bundling all metadata needed to rebuild the original document.

```ts
const jsonDocument: any = xmlStringToJsonObject(xml, { mode: "roundtrip" });
console.log(JSON.stringify(jsonDocument, null, 2));
```

Result:

```json
{
  "rootName": "libraryCatalog",
  "root": {
    "library": {
      "_attributes": {
        "category": "memo"
      },
      "_text": "painters"
    },
    "book": [
      "DaVinci",
      "VanGogh",
      "Rubens"
    ],
    "_content": [
      {
        "kind": "text",
        "value": "\n  "
      },
      {
        "kind": "element",
        "name": "library",
        "occurrence": 0
      },
      {
        "kind": "text",
        "value": "\n  "
      },
      {
        "kind": "element",
        "name": "book",
        "occurrence": 0
      },
      {
        "kind": "text",
        "value": "\n  "
      },
      {
        "kind": "element",
        "name": "book",
        "occurrence": 1
      },
      {
        "kind": "text",
        "value": "\n  "
      },
      {
        "kind": "element",
        "name": "book",
        "occurrence": 2
      },
      {
        "kind": "text",
        "value": "\n"
      }
    ]
  },
  "declaration": {
    "version": "1.0",
    "encoding": "UTF-8"
  },
  "prolog": [
    {
      "type": "text",
      "value": "\n"
    },
    {
      "type": "comment",
      "value": "Before root"
    },
    {
      "type": "text",
      "value": "\n"
    }
  ]
}
```

`_content` lists the ordered mix of child nodes so round-tripping retains indentation, comments, CDATA sections, and processing instructions exactly where they appeared. Each document-level `prolog` (and `epilog`) entry includes the original whitespace as `type: "text"` items to keep formatting intact; when a comment or processing instruction followed the DOCTYPE declaration you will also see `afterDoctype: true` on that entry.

Use this mode when you must preserve declarations, DOCTYPE data, or the exact ordering of mixed content. It produces a richer JSON payload and is ideal for archival or editing tools that need to reconstruct the original bytes faithfully.

### Round-tripping documents

`jsonObjectToXmlDocument` works with either output. Supply the root element name when starting from the simple JSON value, or pass the round-trip payload untouched to restore every piece of metadata:

```ts
import { DOMBuilder, SAXParser, XMLDocument, jsonObjectToXmlDocument, xmlStringToJsonObject } from "typesxml";

const xmlText: string = "<libraryCatalog><library category=\"memo\">painters</library><book>DaVinci</book></libraryCatalog>";

function parseXml(text: string): XMLDocument {
  const handler = new DOMBuilder();
  const parser = new SAXParser();
  parser.setContentHandler(handler);
  parser.parseString(text);
  return handler.getDocument()!;
}

const simpleJson: any = xmlStringToJsonObject(xmlText);
const rebuiltFromSimple: XMLDocument = jsonObjectToXmlDocument(simpleJson, "libraryCatalog");

const jsonDoc: any = xmlStringToJsonObject(xmlText, { mode: "roundtrip" });
const rebuilt: XMLDocument = jsonObjectToXmlDocument(jsonDoc);

console.log(rebuiltFromSimple.equals(parseXml(xmlText))); // true: nothing to lose in a compact document
console.log(rebuilt.equals(parseXml(xmlText))); // true
```

### Plain object view

Simple mode gives you the element content directly, so you can treat the top-level value as the payload. When working with the round-trip structure, use the `root` property to access that same content. Arrays appear whenever an element has repeated children with the same name: three `<book>` elements become `"book": ["…", "…", "…"]`. When the repeated children sit inside a container, as in `<books><book>…</book></books>`, simple mode collapses the container to `"books": [...]` and drops the child name, while round-trip mode keeps it as `"books": { "book": [...] }`. All text content is represented as strings; numbers and booleans are not automatically coerced.

## Advanced: SAX event arrays

TypesXML also exposes SAX event arrays for low-level stream control. Use those APIs when you prefer event-based processing or need to limit memory use. For details on SAX handlers and streaming, consult the advanced API reference together with the streaming sections of the [TypesXML Tutorial](tutorial.md).

## File and stream conversions

Every conversion function is also available for files and streams. Each variant accepts an optional options object; set `mode: "roundtrip"` when you need to retain metadata, or omit it for the lightweight default:

- `xmlFileToJsonObject(path, { mode: "roundtrip" })`, `xmlStreamToJsonObject(stream, { mode: "roundtrip" })` → `XmlJsonDocument` (simple mode when `mode` is omitted).
- `xmlStringToJsonFile(xml, target, { mode: "roundtrip" })`, `xmlFileToJsonFile(path, target, encoding, indent, jsonEncoding, { mode: "roundtrip" })`, `xmlStreamToJsonFile(stream, target, { mode: "roundtrip" })` → write prettified JSON (default two-space indentation).
- `jsonStringToXmlDocument`, `jsonFileToXmlDocument`, `jsonStreamToXmlDocument` → consume JSON and build `XMLDocument` instances.
- `jsonObjectToXmlFile`, `jsonFileToXmlFile`, `jsonStreamToXmlFile` → produce XML output.

## Helper property reference

| Key | Purpose |
| --- | --- |
| `_attributes` | Attribute name/value map. |
| `_text` | Literal text content (whitespace preserved). |
| `_cdata` | CDATA section content, string or array. |
| `_comments` | Comment text, string or array. |
| `_processingInstructions` | Array of `{ target, data? }` instructions. |
| `_content` | (Round-trip mode only) Ordered content metadata (`kind`, `name`, `occurrence`) used to restore exact node ordering. |

Any other property names are treated as child element names. Arrays mapped to those properties describe repeated children; primitives become text nodes inside a single child element.

With these conversion functions you can move between JSON and XML using the same data structures you already work with, while still retaining access to advanced XML features when you need them.
