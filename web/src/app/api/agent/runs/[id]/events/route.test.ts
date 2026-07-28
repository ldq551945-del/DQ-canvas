import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getAgentRun: vi.fn(), getLatestCreativeRunEventId: vi.fn(), listCreativeRunEvents: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(async () => ({ id: "user" })) }));
vi.mock("@/lib/server/agent-run-store", () => ({ getAgentRun: mocks.getAgentRun }));
vi.mock("@/lib/server/creative-runtime-store", () => ({ getLatestCreativeRunEventId: mocks.getLatestCreativeRunEventId, listCreativeRunEvents: mocks.listCreativeRunEvents }));

import { GET } from "./route";

describe("Agent Run SSE", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAgentRun.mockResolvedValue({
            id: "run",
            userId: "user",
            status: "completed",
            tasks: [],
            updatedAt: 3,
        });
        mocks.listCreativeRunEvents.mockResolvedValue([{ id: "2", runId: "run", type: "run.completed", createdAt: 2, data: { reply: "完成" } }]);
        mocks.getLatestCreativeRunEventId.mockResolvedValue("");
    });

    it("resumes after Last-Event-ID and closes after the terminal snapshot", async () => {
        const response = await GET(new Request("http://localhost/api/agent/runs/run/events", { headers: { "last-event-id": "1" } }), { params: Promise.resolve({ id: "run" }) });
        const body = await response.text();

        expect(response.headers.get("content-type")).toContain("text/event-stream");
        expect(body).not.toContain("id: 1");
        expect(body).toContain("id: 2");
        expect(body).toContain("event: run.snapshot");
        expect(body).toContain('"status":"completed"');
        expect(mocks.getAgentRun).toHaveBeenCalledTimes(2);
        expect(mocks.listCreativeRunEvents).toHaveBeenCalledWith("run", "1");
    });

    it("starts after the latest manual retry instead of replaying an older failure", async () => {
        mocks.getAgentRun.mockResolvedValue({ id: "run", userId: "user", status: "running", tasks: [], updatedAt: 4 });
        mocks.getLatestCreativeRunEventId.mockImplementation(async (_runId, type) => (type === "run.retry.requested" ? "11" : "8"));
        mocks.listCreativeRunEvents.mockResolvedValueOnce([{ id: "12", runId: "run", type: "run.planning", createdAt: 4 }]).mockResolvedValue([]);

        const response = await GET(new Request("http://localhost/api/agent/runs/run/events"), { params: Promise.resolve({ id: "run" }) });
        const reader = response.body!.getReader();
        const first = await reader.read();
        await reader.cancel();

        expect(new TextDecoder().decode(first.value)).toContain("id: 12");
        expect(mocks.getLatestCreativeRunEventId).toHaveBeenCalledWith("run", "task.retry.requested");
        expect(mocks.getLatestCreativeRunEventId).toHaveBeenCalledWith("run", "run.retry.requested");
        expect(mocks.listCreativeRunEvents).toHaveBeenCalledWith("run", "11");
    });
});
