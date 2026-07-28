import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CanvasProject } from "@/lib/canvas-project-contract";

const mocks = vi.hoisted(() => ({ files: new Map<string, unknown>(), provider: "file", postgresQuery: vi.fn() }));

vi.mock("@/lib/server/database", () => ({ ensurePostgresSchema: vi.fn(), getDatabaseProvider: vi.fn(() => mocks.provider), postgresQuery: mocks.postgresQuery }));
vi.mock("@/lib/server/data-adapter", () => ({
    readJsonDataFile: vi.fn(async (name: string, fallback: unknown) => structuredClone(mocks.files.has(name) ? mocks.files.get(name) : fallback)),
    writeJsonDataFile: vi.fn(async (name: string, value: unknown) => mocks.files.set(name, structuredClone(value))),
}));

import { createCanvasProject, deleteCanvasProjects, getCanvasProject, getLatestCanvasProjectOverview, listCanvasProjects, listCanvasProjectSummaries, updateCanvasProject } from "./canvas-project-store";

describe("canvas project file provider", () => {
    beforeEach(() => {
        mocks.files.clear();
        mocks.provider = "file";
        mocks.postgresQuery.mockReset();
    });

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

    it("returns file-provider summaries without changing stored project details", async () => {
        await createCanvasProject("user-one", { ...project("one", "项目一"), nodes: [{ id: "node-one" }] as CanvasProject["nodes"] });

        await expect(listCanvasProjectSummaries("user-one")).resolves.toMatchObject([{ id: "one", title: "项目一", nodeCount: 1, connectionCount: 0 }]);
        await expect(getCanvasProject("one", "user-one")).resolves.toMatchObject({ nodes: [{ id: "node-one" }] });
    });

    it("projects only Canvas list summary fields in PostgreSQL", async () => {
        mocks.provider = "postgres";
        mocks.postgresQuery.mockResolvedValue({
            rows: [
                {
                    id: "canvas-one",
                    title: "画布一",
                    source_handoff_id: "handoff-one",
                    creative_conversation_id: "conversation-one",
                    node_count: 8,
                    connection_count: 3,
                    created_at: "2026-07-20T00:00:00.000Z",
                    updated_at: "2026-07-22T00:00:00.000Z",
                },
            ],
        });

        await expect(listCanvasProjectSummaries("user-one")).resolves.toMatchObject([{ id: "canvas-one", nodeCount: 8, connectionCount: 3 }]);
        const [statement, params] = mocks.postgresQuery.mock.calls[0] as [string, unknown[]];
        expect(statement).toContain("jsonb_array_length");
        expect(statement).not.toMatch(/SELECT\s+project_json\s+FROM/i);
        expect(params).toEqual(["user-one"]);
    });

    it("returns only the latest file-provider project summary", async () => {
        const older = { ...project("older", "旧项目"), updatedAt: "2026-07-20T00:00:00.000Z" };
        const latest = {
            ...project("latest", "最近项目"),
            updatedAt: "2026-07-22T00:00:00.000Z",
            nodes: [{ id: "image", type: "image", metadata: { status: "success", serverUrl: "/api/media/latest.webp" } }] as CanvasProject["nodes"],
            connections: [{ id: "edge" }] as CanvasProject["connections"],
        };
        await createCanvasProject("user-one", older);
        await createCanvasProject("user-one", latest);

        await expect(getLatestCanvasProjectOverview("user-one")).resolves.toMatchObject({ id: "latest", nodeCount: 1, connectionCount: 1, previews: [{ kind: "image", url: "/api/media/latest.webp" }] });
    });

    it("uses one bounded PostgreSQL projection instead of returning project_json", async () => {
        mocks.provider = "postgres";
        mocks.postgresQuery.mockResolvedValue({
            rows: [{ id: "latest", title: "最近项目", updated_at: "2026-07-22T00:00:00.000Z", node_count: 9, connection_count: 4, previews: [{ kind: "image", url: "/api/media/cover.webp" }] }],
            rowCount: 1,
        });

        await expect(getLatestCanvasProjectOverview("user-one")).resolves.toMatchObject({ id: "latest", nodeCount: 9, connectionCount: 4 });
        const [statement, params] = mocks.postgresQuery.mock.calls[0] as [string, unknown[]];
        expect(statement).toContain("jsonb_array_length");
        expect(statement).toContain("LIMIT 1");
        expect(statement).not.toMatch(/SELECT\s+project_json/i);
        expect(params).toEqual(["user-one"]);
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
