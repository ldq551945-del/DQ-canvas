import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    mkdir: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
}));

vi.mock("node:fs/promises", () => ({
    copyFile: vi.fn(async () => undefined),
    mkdir: mocks.mkdir,
    readFile: vi.fn(),
    readdir: vi.fn(),
    rename: mocks.rename,
    rm: mocks.rm,
    writeFile: mocks.writeFile,
}));

vi.mock("@/lib/server/data-dir", () => ({ resolveServerDataPath: (fileName: string) => `C:\\dq-data\\${fileName}` }));

import { writeJsonDataFile } from "./data-adapter";

describe("JSON data file writes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("serializes concurrent writes to the same file", async () => {
        const firstWrite = deferred<undefined>();
        mocks.writeFile.mockImplementationOnce(() => firstWrite.promise).mockResolvedValue(undefined);

        const first = writeJsonDataFile("shared.json", { version: 1 });
        const second = writeJsonDataFile("shared.json", { version: 2 });
        await flushMicrotasks();

        expect(mocks.writeFile).toHaveBeenCalledTimes(1);
        firstWrite.resolve(undefined);
        await Promise.all([first, second]);
        expect(mocks.writeFile).toHaveBeenCalledTimes(2);
    });

    it("retries a transient Windows rename failure", async () => {
        mocks.rename.mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "EPERM" })).mockResolvedValue(undefined);

        await writeJsonDataFile("windows-lock.json", { ready: true });

        expect(mocks.rename).toHaveBeenCalledTimes(2);
    });
});

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return { promise, resolve, reject };
}

async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
}
