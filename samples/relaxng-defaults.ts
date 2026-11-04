import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Catalog, DOMBuilder, SAXParser } from "typesxml";

async function main(): Promise<void> {
    const sampleRoot = fileURLToPath(new URL("..", import.meta.url));
    const catalogPath = resolve(sampleRoot, "resources/catalog/catalog.xml");
    const xmlPath = resolve(sampleRoot, "resources/xml/library-rng.xml");

    const catalog = new Catalog(catalogPath);
    const handler = new DOMBuilder();
    const parser = new SAXParser();

    parser.setCatalog(catalog);
    parser.setContentHandler(handler);

    console.log("Parsing library-rng.xml with RelaxNG defaults...");
    parser.parseFile(xmlPath);

    const document = handler.getDocument();
    const root = document?.getRoot();
    if (!root) {
        throw new Error("Document root not available");
    }

    console.log("Root element:", root.getName());
    console.log("Region attribute (RelaxNG default):", root.getAttribute("region")?.getValue());

    root.getChildren().forEach((child) => {
        const isbn = child.getAttribute("isbn")?.getValue();
        const status = child.getAttribute("status")?.getValue();
        const title = child.getChild("title")?.getText().trim();
        console.log(`  Book ISBN=${isbn} status=${status} title=${title}`);
    });

    console.log("Missing attributes filled via RelaxNG default annotations.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
