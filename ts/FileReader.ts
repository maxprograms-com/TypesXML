/*******************************************************************************
 * Copyright (c) 2023-2026 Maxprograms.
 *
 * This program and the accompanying materials
 * are made available under the terms of the Eclipse   License 1.0
 * which accompanies this distribution, and is available at
 * https://www.eclipse.org/org/documents/epl-v10.html
 *
 * Contributors:
 *     Maxprograms - initial API and implementation
 *******************************************************************************/

import { Stats, closeSync, openSync, readSync, statSync } from "node:fs";
import { TextDecoder } from "node:util";

export class FileReader {

    fileHandle: number;
    encoding: BufferEncoding;
    blockSize: number;
    fileSize: number;
    position: number;
    firstRead: boolean;
    private decoder?: TextDecoder;
    private readonly filePath: string;

    constructor(path: string, encoding?: BufferEncoding) {
        this.filePath = path;
        let stats: Stats = statSync(path, { bigint: false, throwIfNoEntry: true });
        this.fileSize = stats.size;
        this.blockSize = stats.blksize && stats.blksize > 0 ? stats.blksize : 8192;
        this.fileHandle = openSync(path, 'r');
        if (encoding) {
            this.encoding = encoding;
        } else {
            this.encoding = FileReader.detectEncoding(path);
        }
        this.position = 0;
        this.firstRead = true;
        this.initializeDecoder();
    }

    static detectEncoding(path: string): BufferEncoding {
        const fd = openSync(path, 'r');
        const buffer: Buffer = Buffer.alloc(3);
        const bytesRead: number = readSync(fd, buffer, 0, 3, 0);

        if (bytesRead === 0) {
            closeSync(fd);
            return 'utf8';
        }

        const slice: Buffer = buffer.subarray(0, bytesRead);
        const UTF8: Buffer = Buffer.from([0xEF, 0xBB, 0xBF]);
        const UTF16LE: Buffer = Buffer.from([0xFF, 0xFE]);
        const UTF16BE: Buffer = Buffer.from([0xFE, 0xFF]);

        if (slice.length >= UTF8.length && slice.compare(UTF8, 0, UTF8.length, 0, UTF8.length) === 0) {
            closeSync(fd);
            return 'utf8';
        }
        if (slice.length >= UTF16LE.length && slice.compare(UTF16LE, 0, UTF16LE.length, 0, UTF16LE.length) === 0) {
            closeSync(fd);
            return 'utf16le';
        }
        if (slice.length >= UTF16BE.length && slice.compare(UTF16BE, 0, UTF16BE.length, 0, UTF16BE.length) === 0) {
            closeSync(fd);
            return 'utf16le';
        }

        const sniffBuffer: Buffer = Buffer.alloc(200);
        const sniffBytesRead: number = readSync(fd, sniffBuffer, 0, 200, 0);
        closeSync(fd);
        const prologText: string = sniffBuffer.toString('latin1', 0, sniffBytesRead);
        const match: RegExpMatchArray | null = prologText.match(/<\?xml\s[^>]*encoding\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
        if (match) {
            let possibleNames: Set<string> = new Set<string>(['ISO-8859-1', 'ISO8859-1']);
            const declaredEncoding: string = (match[1] ?? match[2]).toUpperCase();
            if (possibleNames.has(declaredEncoding)) {
                return 'latin1';
            }
        }
        return 'utf8';
    }

    getEncoding(): BufferEncoding {
        return this.encoding;
    }

    setEncoding(encoding: BufferEncoding): void {
        this.encoding = encoding;
        this.initializeDecoder();
        this.firstRead = true;
    }

    read(): string {
        let buffer: Buffer = Buffer.alloc(this.blockSize);
        let amount: number = this.blockSize <= this.fileSize - this.position ? this.blockSize : this.fileSize - this.position;
        let bytesRead: number = readSync(this.fileHandle, buffer, 0, amount, this.position);
        this.position += bytesRead;
        let decoded: string;
        try {
            if (this.decoder) {
                const stream: boolean = this.position < this.fileSize;
                decoded = this.decoder.decode(buffer.subarray(0, bytesRead), { stream });
            } else {
                decoded = buffer.toString(this.encoding, 0, bytesRead);
            }
        } catch (error) {
            const message: string = (error as Error).message || 'invalid byte sequence';
            throw new Error(`Invalid ${this.encoding} data in "${this.filePath}": ${message}`);
        }
        return this.firstRead ? this.handleInitialChunk(decoded) : decoded;
    }

    handleInitialChunk(text: string): string {
        this.firstRead = false;
        if (!this.decoder && text.length > 0 && text.codePointAt(0) === 0xFEFF) {
            return text.substring(1);
        }
        return text;
    }

    dataAvailable(): boolean {
        return this.position < this.fileSize;
    }

    getFileSize(): number {
        return this.fileSize;
    }

    closeFile(): void {
        closeSync(this.fileHandle);
    }

    private initializeDecoder(): void {
        if (this.encoding === 'utf8') {
            this.decoder = new TextDecoder('utf-8', { fatal: true });
        } else if (this.encoding === 'utf16le') {
            this.decoder = new TextDecoder('utf-16le', { fatal: true });
        } else {
            this.decoder = undefined;
        }
    }
}