import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { resolveServerDataPath } from "@/lib/server/data-dir";

type DataDirectoryEntry = {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
};

const globalDataAdapter = globalThis as typeof globalThis & { __dqDataFileWriteQueues?: Map<string, Promise<void>> };
const dataFileWriteQueues = (globalDataAdapter.__dqDataFileWriteQueues ??= new Map<string, Promise<void>>());

export function resolveDataPath(pathName: string) {
    return resolveServerDataPath(pathName);
}

export async function ensureDataDirectory(pathName: string) {
    await mkdir(resolveServerDataPath(pathName), { recursive: true });
}

export async function readJsonDataFile<T>(fileName: string, fallback: T): Promise<T> {
    try {
        const raw = await readFile(resolveServerDataPath(fileName), "utf8");
        return JSON.parse(raw.trimStart().replace(/^\uFEFF/, "")) as T;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
        throw error;
    }
}

export async function writeJsonDataFile(fileName: string, value: unknown) {
    const filePath = resolveServerDataPath(fileName);
    const previous = dataFileWriteQueues.get(filePath) || Promise.resolve();
    const write = previous.catch(() => undefined).then(() => writeJsonFileAtomically(filePath, value));
    dataFileWriteQueues.set(filePath, write);
    try {
        await write;
    } finally {
        if (dataFileWriteQueues.get(filePath) === write) dataFileWriteQueues.delete(filePath);
    }
}

export async function copyDataFile(sourceFileName: string, targetFileName: string) {
    const targetPath = resolveServerDataPath(targetFileName);
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(resolveServerDataPath(sourceFileName), targetPath);
}

export async function listDataDirectory(pathName: string): Promise<DataDirectoryEntry[]> {
    return readdir(resolveServerDataPath(pathName), { withFileTypes: true });
}

export async function removeDataPath(pathName: string) {
    await rm(resolveServerDataPath(pathName), { recursive: true, force: true });
}

async function writeJsonFileAtomically(filePath: string, value: unknown) {
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(dirname(filePath), { recursive: true });
    try {
        await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
        await renameWithRetry(temporaryPath, filePath);
    } finally {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
}

async function renameWithRetry(source: string, target: string) {
    const deadline = Date.now() + 2_000;
    let delayMs = 5;
    for (;;) {
        try {
            await rename(source, target);
            return;
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (!code || !["EACCES", "EBUSY", "EPERM"].includes(code) || Date.now() >= deadline) throw error;
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            delayMs = Math.min(100, delayMs * 2);
        }
    }
}
