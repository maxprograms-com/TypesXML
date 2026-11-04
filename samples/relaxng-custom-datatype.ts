import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Datatype, DatatypeBuilder, DatatypeLibrary, DatatypeStreamingValidator, DatatypeValidationContext } from "typesxml";
import { DatatypeException, DatatypeLibraryRegistry, DOMBuilder, IdType, SAXParser, StreamingValidatorImpl } from "typesxml";

const LIBRARY_URI: string = "urn:typesxml:samples:datatypes";

class EvenInteger implements Datatype {

    constructor(private readonly maxInclusive: number | undefined) { }

    isValid(literal: string, _context: DatatypeValidationContext | null): boolean {
        const text: string = literal.trim();
        if (!/^-?\d+$/.test(text)) {
            return false;
        }
        const value: number = Number(text);
        return value % 2 === 0 && (this.maxInclusive === undefined || value <= this.maxInclusive);
    }

    checkValid(literal: string, context: DatatypeValidationContext | null): void {
        if (!this.isValid(literal, context)) {
            throw new DatatypeException("\"" + literal + "\" is not a valid evenInteger");
        }
    }

    createStreamingValidator(context: DatatypeValidationContext | null): DatatypeStreamingValidator {
        return new StreamingValidatorImpl(this, context);
    }

    createValue(literal: string, context: DatatypeValidationContext | null): unknown | null {
        return this.isValid(literal, context) ? Number(literal.trim()) : null;
    }

    sameValue(first: unknown, second: unknown): boolean {
        return first === second;
    }

    valueHashCode(value: unknown): number {
        return Number(value) | 0;
    }

    getIdType(): IdType {
        return IdType.NULL;
    }

    isContextDependent(): boolean {
        return false;
    }
}

class EvenIntegerBuilder implements DatatypeBuilder {

    private maxInclusive: number | undefined;

    addParameter(name: string, value: string, _context: DatatypeValidationContext | null): void {
        if (name !== "maxInclusive") {
            throw new DatatypeException("Unsupported parameter \"" + name + "\"");
        }
        this.maxInclusive = Number(value);
    }

    createDatatype(): Datatype {
        return new EvenInteger(this.maxInclusive);
    }
}

class SampleLibrary implements DatatypeLibrary {

    createDatatypeBuilder(typeName: string): DatatypeBuilder {
        if (typeName !== "evenInteger") {
            throw new DatatypeException("Unknown datatype \"" + typeName + "\"");
        }
        return new EvenIntegerBuilder();
    }

    createDatatype(typeName: string): Datatype {
        return this.createDatatypeBuilder(typeName).createDatatype();
    }
}

function validate(path: string): void {
    const parser: SAXParser = new SAXParser();
    parser.setContentHandler(new DOMBuilder());
    parser.setValidating(true);
    try {
        parser.parseFile(path);
        console.log(path + ": valid");
    } catch (error) {
        console.log(path + ": " + (error instanceof Error ? error.message.split("\n")[0] : String(error)));
    }
}

function main(): void {
    const sampleRoot: string = fileURLToPath(new URL("..", import.meta.url));

    DatatypeLibraryRegistry.getInstance().registerLibrary(LIBRARY_URI, new SampleLibrary());

    validate(resolve(sampleRoot, "resources/xml/measurements-valid.xml"));
    validate(resolve(sampleRoot, "resources/xml/measurements-invalid.xml"));
}

main();
