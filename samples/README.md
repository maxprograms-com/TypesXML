# TypesXML Samples

These TypeScript snippets mirror the scenarios covered in `docs/tutorial.md`. `typesxml` resolves to the parent folder (`"typesxml": "file:.."`).

Start with the [project README](../README.md) for a high-level overview, then follow the detailed walkthrough in [`docs/tutorial.md`](../docs/tutorial.md) if you need extra context while running these scripts. For XML↔JSON workflows, pair these samples with the [JSON and XML Conversion Guide](../docs/jsonTutorial.md).

## Prerequisites

```bash
# Repository root
npm install
npm run build

# Samples
cd samples
npm install
```

Each file is self-contained and documented inline. After installing you can execute them via `npm run <script>` (see below). The scripts compile the TypeScript sources with `tsc` and then run the emitted JavaScript from `dist/` so the setup mirrors a real project build.

Example data lives under `resources/`. `xml/library.xml` references a schema published at `http://example.com/samples/schema`, which is resolved locally through the catalog in `resources/catalog/catalog.xml`. The scripts compute absolute paths to these files at runtime, matching the requirement of the `Catalog` API.

A DTD-backed pair—`xml/library-valid.xml` and `xml/library-invalid.xml`—demonstrates DTD validation using `resources/dtd/sample.dtd`. The RelaxNG grammar in `resources/rng/library.rng` is referenced by `xml/library-rng.xml` to showcase default attribute merging without validation mode.

## Sample Index

- `parse-file.ts` – Parse a local XML file, traverse the DOM, and report attribute values.
- `catalog-validated.ts` – Load an OASIS catalog, show XML Schema merged default attributes, and optionally enforce DTD validation via command-line flags.
- `relaxng-defaults.ts` – Resolve a RelaxNG grammar via catalog lookup and observe default attributes merged into the DOM.
- `relaxng-custom-datatype.ts`: Register a custom RelaxNG datatype library and validate documents against a grammar that uses it.
- `grammar-cache.ts`: Parse documents that share grammars with and without a `GrammarCache` and compare the timings.
- `stream-parse.ts` – Fetch an XML document over HTTPS and process it as a stream.
- `custom-handler.ts` – Implement a bespoke `ContentHandler` that logs SAX events.
- `json-conversion.ts` – Convert between JSON and XML, comparing simple mode with the metadata-preserving round-trip mode.

Shortcut scripts are defined in `package.json`, e.g. `npm run parse-file` (which performs `tsc -p tsconfig.json` and then runs `node dist/parse-file.js`). Use `npm run build` if you want to compile everything ahead of time.

To explore the most common scenarios directly:

- `npm run parse-file` – build the samples and print a quick DOM traversal of the catalog-backed library.
- `npm run stream-parse` – build the samples and fetch a remote XML document over HTTPS, printing the raw payload.
- `npm run custom-handler` – build the samples and stream SAX events through the logging handler.
- `npm run relaxng-defaults` – build the samples and parse `library-rng.xml`, showing RelaxNG defaults applied even without validation.
- `npm run relaxng-custom-datatype`: build the samples, register the custom `evenInteger` datatype library, and validate `measurements-valid.xml` and `measurements-invalid.xml` against `resources/rng/measurements.rng`.
- `npm run grammar-cache`: build the samples and compare parse times with and without a shared `GrammarCache`.
- `npm run json-conversion` – build the samples and see JSON↔XML conversion in both simple and round-trip modes.

For the validation sample:

- `npm run catalog-validated` (default) loads the XML Schema-backed example to show merged defaults.
- `npm run catalog-validated -- dtd` enforces the bundled DTD on `library-valid.xml`.
- `npm run catalog-validated -- invalid` intentionally parses `library-invalid.xml` and surfaces the validation error.
