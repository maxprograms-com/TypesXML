/*******************************************************************************
 * Copyright (c) 2023-2026 Maxprograms.
 *
 * This program and the accompanying materials
 * are made available under the terms of the Eclipse Public License 1.0
 * which accompanies this distribution, and is available at
 * https://www.eclipse.org/org/documents/epl-v10.html
 *
 * Contributors:
 *     Maxprograms - initial API and implementation
 *******************************************************************************/

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DOMBuilder } from '../DOMBuilder.js';
import { RelaxNGParser } from '../RelaxNGParser.js';
import { SAXParser } from '../SAXParser.js';
import { XMLElement } from '../XMLElement.js';
import { RelaxNGSchema } from '../relaxng/PatternBuilder.js';

const SUITE_FILE: string = './tests/relaxng/spectest.xml';
const SUPPORTED_LIBRARIES: Set<string> = new Set<string>(['http://www.w3.org/2001/XMLSchema-datatypes']);
const RNG_NS: string = 'http://relaxng.org/ns/structure/1.0';

type Failure = {
    number: number;
    section: string;
    kind: string;
    detail: string;
};

class RelaxNGTestSuite {

    private total: number = 0;
    private passed: number = 0;
    private skipped: number = 0;
    private caseNumber: number = 0;
    private readonly failures: Failure[] = [];
    private readonly only: number | undefined;

    constructor() {
        if (!existsSync(SUITE_FILE)) {
            throw new Error('RelaxNG test suite not found at ' + SUITE_FILE);
        }
        this.only = process.env.RNG_CASE ? Number.parseInt(process.env.RNG_CASE) : undefined;
    }

    run(): void {
        const builder: DOMBuilder = new DOMBuilder();
        const parser: SAXParser = new SAXParser();
        parser.setContentHandler(builder);
        parser.parseFile(SUITE_FILE);
        const root: XMLElement | undefined = builder.getDocument()?.getRoot();
        if (!root) {
            throw new Error('Could not read ' + SUITE_FILE);
        }
        this.runSuite(root);
        this.report();
    }

    private runSuite(suite: XMLElement): void {
        for (const child of suite.getChildren()) {
            if (child.getName() === 'testSuite') {
                this.runSuite(child);
            } else if (child.getName() === 'testCase') {
                this.caseNumber++;
                if (this.only === undefined || this.only === this.caseNumber) {
                    this.runCase(child, this.caseNumber);
                }
            }
        }
    }

    private writeResources(parent: XMLElement, directory: string): void {
        for (const child of parent.getChildren()) {
            if (child.getName() === 'resource') {
                const content: XMLElement | undefined = child.getChildren()[0];
                writeFileSync(join(directory, child.getAttribute('name')?.getValue() ?? ''), content ? content.toString() : '', 'utf8');
            } else if (child.getName() === 'dir') {
                const sub: string = join(directory, child.getAttribute('name')?.getValue() ?? '');
                mkdirSync(sub, { recursive: true });
                this.writeResources(child, sub);
            }
        }
    }

    private runCase(testCase: XMLElement, number: number): void {
        const section: string = testCase.getChild('section')?.getText().trim() ?? '';
        for (const requires of testCase.getChildren().filter((c: XMLElement) => c.getName() === 'requires')) {
            if (!SUPPORTED_LIBRARIES.has(requires.getAttribute('datatypeLibrary')?.getValue() ?? '')) {
                this.skipped++;
                return;
            }
        }
        const directory: string = mkdtempSync(join(tmpdir(), 'rngtest-'));
        try {
            this.writeResources(testCase, directory);
            const incorrect: XMLElement | undefined = testCase.getChild('incorrect');
            const correct: XMLElement | undefined = testCase.getChild('correct');
            const schemaHolder: XMLElement | undefined = incorrect ?? correct;
            if (!schemaHolder) {
                return;
            }
            const schemaElement: XMLElement | undefined = schemaHolder.getChildren()[0];
            const schemaPath: string = join(directory, 'schema.rng');
            writeFileSync(schemaPath, schemaElement ? schemaElement.toString() : '', 'utf8');

            let schema: RelaxNGSchema | undefined;
            let loadError: string | undefined;
            try {
                schema = new RelaxNGParser(schemaPath).getSchema();
            } catch (error) {
                loadError = error instanceof Error ? error.message : String(error);
            }
            this.total++;
            if (incorrect) {
                if (loadError === undefined) {
                    this.fail(number, section, 'incorrect schema accepted', schemaElement ? schemaElement.toString().replaceAll(/\s+/g, ' ').substring(0, 160) : '');
                } else {
                    this.passed++;
                }
                return;
            }
            if (loadError !== undefined || !schema) {
                this.fail(number, section, 'correct schema rejected', loadError ?? '');
                return;
            }
            this.passed++;
            let index: number = 0;
            for (const instance of testCase.getChildren().filter((c: XMLElement) => c.getName() === 'valid' || c.getName() === 'invalid')) {
                index++;
                this.total++;
                const expectValid: boolean = instance.getName() === 'valid';
                const root: XMLElement | undefined = instance.getChildren()[0];
                const instancePath: string = join(directory, 'instance' + index + '.xml');
                const text: string = '<?xml version="1.0" encoding="UTF-8"?>\n<?xml-model href="schema.rng" schematypens="' + RNG_NS + '"?>\n' + (root ? root.toString() : '');
                writeFileSync(instancePath, text, 'utf8');
                let outcome: string | undefined;
                try {
                    const parser: SAXParser = new SAXParser();
                    parser.setContentHandler(new DOMBuilder());
                    parser.setValidating(true);
                    parser.parseFile(instancePath);
                } catch (error) {
                    outcome = error instanceof Error ? error.message : String(error);
                }
                if (expectValid && outcome === undefined) {
                    this.passed++;
                } else if (!expectValid && outcome !== undefined && outcome.includes('RelaxNG validation error')) {
                    this.passed++;
                } else if (expectValid) {
                    this.fail(number, section, 'valid instance ' + index + ' rejected', (outcome ?? '').split('\n')[0]);
                } else if (outcome === undefined) {
                    this.fail(number, section, 'invalid instance ' + index + ' accepted', text.split('\n')[2].substring(0, 160));
                } else {
                    this.fail(number, section, 'invalid instance ' + index + ' failed for another reason', outcome.split('\n')[0]);
                }
            }
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    }

    private fail(number: number, section: string, kind: string, detail: string): void {
        this.failures.push({ number: number, section: section, kind: kind, detail: detail });
    }

    private report(): void {
        for (const failure of this.failures) {
            console.log('case ' + failure.number + ' [section ' + failure.section + '] ' + failure.kind + ': ' + failure.detail.substring(0, 200));
        }
        const effective: number = this.total;
        const pct: string = effective > 0 ? ((this.passed / effective) * 100).toFixed(1) : '0.0';
        console.log('');
        console.log('RelaxNG: passed ' + this.passed + '/' + effective + ' (' + pct + '%), failed ' + this.failures.length + ', skipped ' + this.skipped + ' cases');
    }
}

try {
    new RelaxNGTestSuite().run();
} catch (error) {
    console.error('Error running RelaxNG Test Suite:', error);
}
