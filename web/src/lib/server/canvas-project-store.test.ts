import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CanvasProject } from "@/lib/canvas-project-contract";

const mocks = vi.hoisted(() => ({ files: new Map<string, unknown>() }));

vi.mock("@/lib/server/database", () => ({ ensurePostgresSchema: vi.fn(), getDatabaseProvider: vi.fn(() => "file"), postgresQuery: vi.fn() }));
vi.mock("@/lib/server/data-adapter", () => ({
    readJsonDataFile: vi.fn(async (name: string, fallback: unknown) => structuredClone(mocks.files.has(name) ? mocks.files.get(name) : fallback)),
    writeJsonDataFile: vi.fn(async (name: string, value: unknown) => mocks.files.set(name, structuredClone(value))),
}));

import { createCanvasProject, deleteCanvasProjects, getCanvasProject, listCanvasProjects, updateCanvasProject } from "./canvas-project-store";

describe("canvas project file provider", () => {
    beforeEach(() => mocks.files.clear());

    it("persists the complete project snapshot and isolates users", async () => {
        await createCanvasProject("user-one", project("one", "项目一"));
        await createCanvasProject("user-two", project("two", "项目二"));

        expect(await listCanvasProjects("user-one")).toMatchObject([{ id: "one", creativeConversationId: "conversation-one" }]);
        expect(await getCanvasProject("two", "user-one")).toBeNull();
        await expect(updateCanvasProject("user-one", project("two", "越权修改"))).rejects.toMatchObject({ status: 404 });

        const updated = { ...project("one", "已更新"), nodes: [{ id: "node-one" }] as CanvasProject["nodes"], updatedAt: new Date(Date.now() + 1000).toISOString() };
        await updateCanvasProject("user-one", updated);
        expect(await getCanvasProject("one", "user-one")).toMatchObject({ title: "已更新", nodes: [{ id: "node-one" }] });
        expect(await deleteCanvasProjects("user-one", ["one", "two"])).toBe(1);
    });
});

function project(id: string, title: string): CanvasProject {
    const now = new Date().toISOString();
    return {
        id,
        title,
        sourceHandoffId: `handoff-${id}`,
        creativeConversationId: `conversation-${id}`,
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        createdAt: now,
        updatedAt: now,
    };
}
