import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";

type FileLockOptions = {
    timeoutMs?: number;
    staleMs?: number;
};

export async function withExclusiveFileLock<T>(lockPath: string, callback: () => Promise<T>, options: FileLockOptions = {}) {
    const timeoutMs = bounded(options.timeoutMs, 1_000, 120_000, 30_000);
    const staleMs = bounded(options.staleMs, 30_000, 30 * 60_000, 5 * 60_000);
    const deadline = Date.now() + timeoutMs;
    const token = `${process.pid}:${randomUUID()}`;
    await mkdir(dirname(lockPath), { recursive: true });

    let handle;
    for (;;) {
        try {
            handle = await open(lockPath, "wx", 0o600);
            await handle.writeFile(JSON.stringify({ token, pid: process.pid, createdAt: Date.now() }), "utf8");
            break;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            await removeStaleLock(lockPath, staleMs);
            if (Date.now() >= deadline) throw new Error(`Timed out waiting for file lock: ${lockPath}`);
            await delay(20 + Math.floor(Math.random() * 31));
        }
    }

    try {
        return await callback();
    } finally {
        await handle.close().catch(() => undefined);
        await releaseOwnedLock(lockPath, token);
    }
}

async function removeStaleLock(lockPath: string, staleMs: number) {
    try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > staleMs) await rm(lockPath, { force: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
}

async function releaseOwnedLock(lockPath: string, token: string) {
    try {
        const current = JSON.parse(await readFile(lockPath, "utf8")) as { token?: unknown };
        if (current.token === token) await rm(lockPath, { force: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
}

function bounded(value: number | undefined, minimum: number, maximum: number, fallback: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.floor(parsed))) : fallback;
}

function delay(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
