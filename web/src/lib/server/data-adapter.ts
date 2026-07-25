import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { resolveServerDataPath } from "@/lib/server/data-dir";

type DataDirectoryEntry = {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
};

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
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
