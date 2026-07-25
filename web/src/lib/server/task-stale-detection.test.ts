import { beforeEach, describe, expect, it, vi } from "vitest";

const taskMemory = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock("@/lib/server/database", () => ({
    getDatabaseProvider: vi.fn(() => "file"),
    ensurePostgresSchema: vi.fn(),
    postgresQuery: vi.fn(),
    withPostgresTransaction: vi.fn(),
}));

vi.mock("@/lib/server/data-adapter", () => ({
    readJsonDataFile: vi.fn(async (_fileName: string, fallback: unknown) => taskMemory.value ?? fallback),
    writeJsonDataFile: vi.fn(async (_fileName: string, value: unknown) => {
        taskMemory.value = structuredClone(value);
    }),
}));

import { createAudioTask, getAudioTask } from "./audio-task-store";

type StoredTaskRecord = {
    id: string;
    userId: string;
    type: string;
    status: string;
    payload: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
    expiresAt: number;
    [key: string]: unknown;
};

describe("audio task stale detection", () => {
    beforeEach(() => {
        taskMemory.value = undefined;
    });

    it("returns a fresh task in its original status", async () => {
        const task = await createAudioTask({
            userId: "user-1",
            config: { baseUrl: "https://api.test", apiKey: "key", apiFormat: "openai", model: "tts-1" },
            prompt: "Hello world",
        });

        const retrieved = await getAudioTask(task.id);
        expect(retrieved).toBeTruthy();
        expect(retrieved!.status).toBe("pending");
        expect(retrieved!.error).toBeUndefined();
    });

    it("marks a pending task as error when its updatedAt is older than 5 minutes", async () => {
        const task = await createAudioTask({
            userId: "user-1",
            config: { baseUrl: "https://api.test", apiKey: "key", apiFormat: "openai", model: "tts-1" },
            prompt: "Hello world",
        });

        // Set the task's updatedAt to 6 minutes ago
        const sixMinutesAgo = Date.now() - 6 * 60 * 1000;
        const records = taskMemory.value as StoredTaskRecord[];
        const record = records.find((r) => r.id === task.id);
        expect(record).toBeTruthy();
        record!.updatedAt = sixMinutesAgo;
        record!.payload.updatedAt = sixMinutesAgo;

        const retrieved = await getAudioTask(task.id);
        expect(retrieved).toBeTruthy();
        expect(retrieved!.status).toBe("error");
        expect(retrieved!.error).toContain("中断");
    });

    it("does not mark a completed task as stale regardless of updatedAt", async () => {
        const task = await createAudioTask({
            userId: "user-1",
            config: { baseUrl: "https://api.test", apiKey: "key", apiFormat: "openai", model: "tts-1" },
            prompt: "Hello world",
        });

        // Transition to success, then set updatedAt to long ago
        const records = taskMemory.value as StoredTaskRecord[];
        const record = records.find((r) => r.id === task.id);
        expect(record).toBeTruthy();
        record!.status = "success";
        record!.payload.status = "success";
        record!.updatedAt = Date.now() - 10 * 60 * 1000;
        record!.payload.updatedAt = Date.now() - 10 * 60 * 1000;

        const retrieved = await getAudioTask(task.id);
        expect(retrieved).toBeTruthy();
        expect(retrieved!.status).toBe("success");
    });
});
