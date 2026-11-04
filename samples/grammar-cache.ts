import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Catalog, DOMBuilder, GrammarCache, SAXParser } from "typesxml";

function parse(path: string, catalog: Catalog, cache?: GrammarCache): number {
    const parser: SAXParser = new SAXParser();
    parser.setContentHandler(new DOMBuilder());
    parser.setCatalog(catalog);
    if (cache) {
        parser.setGrammarCache(cache);
    }
    const start: number = performance.now();
    parser.parseFile(path);
    return performance.now() - start;
}

function main(): void {
    const sampleRoot: string = fileURLToPath(new URL("..", import.meta.url));
    const catalog: Catalog = new Catalog(resolve(sampleRoot, "resources/catalog/catalog.xml"));
    const names: string[] = ["library.xml", "library-rng.xml", "library-valid.xml"];
    const cache: GrammarCache = new GrammarCache();

    for (let round: number = 1; round <= 3; round++) {
        console.log("Round " + round);
        for (const name of names) {
            const path: string = resolve(sampleRoot, "resources/xml", name);
            const withoutCache: number = parse(path, catalog);
            const withCache: number = parse(path, catalog, cache);
            console.log("  " + name.padEnd(20) + "no cache " + withoutCache.toFixed(2).padStart(7) + " ms   cache " + withCache.toFixed(2).padStart(7) + " ms");
        }
    }
}

main();
