import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Catalog, DOMBuilder, SAXParser } from "typesxml";

async function main(): Promise<void> {
    const sampleRoot = fileURLToPath(new URL("..", import.meta.url));
    // Catalog expects an absolute path, so anchor the lookup to this file.
    const catalogPath = resolve(sampleRoot, "resources/catalog/catalog.xml");
    const [, , mode] = process.argv;
    const useDtd = mode === "dtd" || mode === "invalid";
    const target = useDtd
        ? `library-${mode === "invalid" ? "invalid" : "valid"}.xml`
        : "library.xml";
    const xmlPath = resolve(sampleRoot, "resources/xml", target);

    const catalog = new Catalog(catalogPath);
    const handler = new DOMBuilder();
    const parser = new SAXParser();

    parser.setCatalog(catalog);
    parser.setValidating(useDtd); // Enforce DTD rules only in DTD demo mode.
    parser.setContentHandler(handler);

    console.log(`Parsing ${target} (${useDtd ? "DTD validation" : "schema defaults"})...`);

    try {
        parser.parseFile(xmlPath);
    } catch (error) {
        console.error("Validation failed", error);
        process.exitCode = 1;
        return;
    }

    const document = handler.getDocument();
    const root = document?.getRoot();
    if (!root) {
        throw new Error("Document root not available");
    }

    console.log("Root element:", root.getName());
    if (useDtd) {
        console.log("Book entries:");
        root.getChildren().forEach((child) => {
            const isbn = child.getAttribute("isbn")?.getValue();
            console.log(`  <${child.getName()}> isbn=${isbn}`);
        });
    } else {
        console.log("Merged defaults:");
        root.getAttributes().forEach((attribute) => {
            console.log(`  ${attribute.getName()} = ${attribute.getValue()}`);
        });

        root.getChildren().forEach((child) => {
            const status = child.getAttribute("status")?.getValue();
            console.log(`Child <${child.getName()}> status=${status}`);
        });
    }

    if (!useDtd) {
        console.log("Schemas processed:", Array.from(parser.processedSchemaLocations));
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
