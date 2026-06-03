import { execFileSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';

export class FetchUrls {

    errorMessage: string;

    constructor() {
        this.errorMessage = '';
    }

    getError(): string {
        return this.errorMessage;
    }

    fetch(url: string, outputPath: string): boolean {
        this.errorMessage = '';
        if (existsSync(outputPath)) {
            unlinkSync(outputPath);
        }
        const module = url.startsWith('https') ? 'https' : 'http';
        const script =
            'const m = require("' + module + '");' +
            'const fs = require("fs");' +
            'm.get(' + JSON.stringify(url) + ', res => {' +
            'if (res.statusCode !== 200) { process.stderr.write("Received status code " + res.statusCode + " trying to fetch ' + url + '\\n"); process.exit(1); }' +
            'const d = [];' +
            'res.on("data", c => d.push(c));' +
            'res.on("end", () => fs.writeFileSync(' + JSON.stringify(outputPath) + ', Buffer.concat(d).toString("utf-8"), "utf-8"));' +
            'res.on("error", err => { process.stderr.write("Error trying to fetch ' + url + ': " + err.message + "\\n"); process.exit(1); });' +
            '});';
        try {
            execFileSync(process.execPath, ['-e', script], { stdio: 'pipe' });
            return true;
        } catch (err: any) {
            this.errorMessage = err.stderr?.toString().trim() ?? '';
            return false;
        }
    }
}