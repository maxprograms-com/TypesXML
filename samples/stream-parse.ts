import { DOMBuilder, SAXParser } from "typesxml";
import { request } from "node:https";

async function fetchFeed(url: string): Promise<void> {
    const handler = new DOMBuilder();
    const parser = new SAXParser();
    parser.setContentHandler(handler);

    await new Promise<void>((resolve, reject) => {
        request(url, (response) => {
            if (!response) {
                reject(new Error("Empty response"));
                return;
            }
            parser.parseStream(response)
                .then(resolve)
                .catch(reject);
        })
            .on("error", reject)
            .end();
    });

    const rootName = handler.getDocument()?.getRoot()?.getName();
    console.log(`Fetched ${url} root element: ${rootName}`);

    const document = handler.getDocument();
    if (!document) {
        throw new Error("Parsed document is unavailable");
    }

    console.log("\nDownloaded document:\n");
    console.log(document.toString());
}

fetchFeed("https://www.w3schools.com/xml/note.xml").catch((error) => {
    console.error("Stream parsing failed", error);
    process.exitCode = 1;
});
