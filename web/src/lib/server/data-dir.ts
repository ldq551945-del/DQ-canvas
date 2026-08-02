import { basename, dirname, resolve } from "node:path";

export function getServerDataDir() {
    const configuredDir = process.env.DQ_DATA_DIR?.trim();
    if (configuredDir) return resolve(/*turbopackIgnore: true*/ configuredDir);

    const cwd = /*turbopackIgnore: true*/ process.cwd();
    if (basename(cwd) === "standalone" && basename(dirname(cwd)) === ".next") {
        return resolve(cwd, "..", "..", ".data");
    }
    return resolve(cwd, ".data");
}

export function resolveServerDataPath(fileName: string) {
    return resolve(getServerDataDir(), fileName);
}
