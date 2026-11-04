import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DOMBuilder, SAXParser, XMLElement } from "typesxml";

async function main(): Promise<void> {
    // Resolve the path to a bundled XML file. Swap in your own XML document whenever needed.
    const sampleRoot = fileURLToPath(new URL("..", import.meta.url));
    const xmlPath = resolve(sampleRoot, "resources/xml/library.xml");

    const handler = new DOMBuilder();
    const parser = new SAXParser();
    parser.setContentHandler(handler);

    parser.parseFile(xmlPath);

    const document = handler.getDocument();
    if (!document) {
        throw new Error("Parsed document is undefined");
    }

    const root: XMLElement | undefined = document.getRoot();
    if (!root) {
        throw new Error("Root element not found");
    }

    console.log("Root:", root.getName());
    console.log("Child count:", root.getChildren().length);

    // Walk the first-level children.
    root.getChildren().forEach((child) => {
        const isbn = child.getAttribute("isbn")?.getValue();
        const title = child.getChild("title")?.getText().trim() ?? "(no title)";
        console.log(`- <${child.getName()}> isbn=${isbn ?? "(none)"} title="${title}"`);
    });
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
