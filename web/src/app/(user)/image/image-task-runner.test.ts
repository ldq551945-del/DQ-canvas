import { describe, expect, it, vi } from "vitest";

import { ImageTaskControllers, ImageTaskQueue, imageTaskControllerKey } from "./image-task-runner";

describe("image task runner", () => {
    it("runs queued tasks when a slot is released", async () => {
        let concurrencyLimit = 1;
        const activeCounts: number[] = [];
        const deleted = new Set<string>();
        const queue = new ImageTaskQueue({
            getConcurrencyLimit: () => concurrencyLimit,
            isResultDeleted: (logId, resultId) => deleted.has(`${logId}:${resultId}`),
            onActiveCountChange: (count) => activeCounts.push(count),
        });
        const firstGate = deferred<void>();
        const started: string[] = [];

        const firstRun = queue.run("log-1", "result-1", async () => {
            started.push("result-1");
            await firstGate.promise;
            return "first";
        });
        const secondRun = queue.run("log-1", "result-2", async () => {
            started.push("result-2");
            return "second";
        });

        await flushMicrotasks();
        expect(started).toEqual(["result-1"]);
        expect(queue.activeTasks).toBe(1);

        firstGate.resolve();
        await expect(firstRun).resolves.toBe("first");
        await expect(secondRun).resolves.toBe("second");
        expect(started).toEqual(["result-1", "result-2"]);
        expect(activeCounts).toEqual([1, 0, 1, 0]);
    });

    it("starts queued work when concurrency increases", async () => {
        let concurrencyLimit = 1;
        const queue = new ImageTaskQueue({
            getConcurrencyLimit: () => concurrencyLimit,
            isResultDeleted: () => false,
        });
        const firstGate = deferred<void>();
        const started: string[] = [];

        const firstRun = queue.run("log-1", "result-1", async () => {
            started.push("result-1");
            await firstGate.promise;
        });
        const secondRun = queue.run("log-1", "result-2", async () => {
            started.push("result-2");
        });

        await flushMicrotasks();
        expect(started).toEqual(["result-1"]);

        concurrencyLimit = 2;
        queue.startQueuedTasks();
        await flushMicrotasks();
        expect(started).toEqual(["result-1", "result-2"]);

        firstGate.resolve();
        await Promise.all([firstRun, secondRun]);
    });

    it("skips deleted results before and after waiting for a slot", async () => {
        const deleted = new Set<string>(["log-1:deleted-before"]);
        const queue = new ImageTaskQueue({
            getConcurrencyLimit: () => 1,
            isResultDeleted: (logId, resultId) => deleted.has(`${logId}:${resultId}`),
        });
        const worker = vi.fn(async () => "should-not-run");

        await expect(queue.run("log-1", "deleted-before", worker)).resolves.toBeUndefined();
        expect(worker).not.toHaveBeenCalled();

        const firstGate = deferred<void>();
        const firstRun = queue.run("log-1", "result-1", async () => {
            await firstGate.promise;
        });
        const queuedWorker = vi.fn(async () => "queued");
        const queuedRun = queue.run("log-1", "deleted-after", queuedWorker);

        await flushMicrotasks();
        deleted.add("log-1:deleted-after");
        firstGate.resolve();
        await firstRun;
        await expect(queuedRun).resolves.toBeUndefined();
        expect(queuedWorker).not.toHaveBeenCalled();
        expect(queue.activeTasks).toBe(0);
    });

    it("tracks task abort controllers by log, result, and task id", () => {
        const controllers = new ImageTaskControllers();
        const controller = controllers.create("log-1", "result-1", "task-1");

        expect(imageTaskControllerKey("log-1", "result-1", "task-1")).toBe("log-1:result-1:task-1");
        expect(controllers.has("log-1", "result-1", "task-1")).toBe(true);
        expect(controller.signal.aborted).toBe(false);

        expect(controllers.abortAndRemove("log-1", "result-1", "task-1")).toBe(true);
        expect(controller.signal.aborted).toBe(true);
        expect(controllers.has("log-1", "result-1", "task-1")).toBe(false);
        expect(controllers.abortAndRemove("log-1", "result-1", "task-1")).toBe(false);
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
