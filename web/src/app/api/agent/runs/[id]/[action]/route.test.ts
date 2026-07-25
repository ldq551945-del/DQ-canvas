import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    countActive: vi.fn(),
    executeAgentRun: vi.fn(),
    getAuthSettings: vi.fn(),
    getAgentRun: vi.fn(),
    setAgentRunStatus: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => {
    const actual = await importOriginal<typeof import("next/server")>();
    return { ...actual, after: vi.fn((callback: () => unknown) => callback()) };
});
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(async () => ({ id: "user" })) }));
vi.mock("@/lib/auth/store", () => ({ getAuthSettings: mocks.getAuthSettings }));
vi.mock("@/lib/server/agent-run-executor", () => ({ abortAgentRun: vi.fn(), executeAgentRun: mocks.executeAgentRun }));
vi.mock("@/lib/server/agent-run-store", () => ({ getAgentRun: mocks.getAgentRun, setAgentRunStatus: mocks.setAgentRunStatus }));
vi.mock("@/lib/server/generation-task-store", () => ({ withGenerationConcurrencyLimit: vi.fn(async (_userId, _type, _staleMs, limit, handler) => ((await mocks.countActive()) >= limit ? null : handler())) }));
vi.mock("@/lib/server/internal-origin", () => ({ fetchInternalApi: vi.fn(), resolveInternalOrigin: vi.fn(() => "http://localhost") }));

import { POST } from "./route";

describe("Agent Run resume concurrency", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        const run = { id: "run", userId: "user", status: "paused", tasks: [] };
        mocks.getAgentRun.mockResolvedValue(run);
        mocks.setAgentRunStatus.mockResolvedValue({ ...run, status: "running" });
        mocks.countActive.mockResolvedValue(1);
        mocks.getAuthSettings.mockResolvedValueOnce({ generationConcurrency: { agent: 2 } }).mockResolvedValueOnce({ generationConcurrency: { agent: 1 } });
    });

    it("reads the latest backend concurrency limit on every resume request", async () => {
        const first = await POST(request(), context());
        const second = await POST(request(), context());

        expect(first.status).toBe(200);
        expect(second.status).toBe(429);
        expect(mocks.getAuthSettings).toHaveBeenCalledTimes(2);
        expect(mocks.setAgentRunStatus).toHaveBeenCalledTimes(1);
    });
});

function request() {
    return new Request("http://localhost/api/agent/runs/run/resume", { method: "POST" });
}

function context() {
    return { params: Promise.resolve({ id: "run", action: "resume" }) };
}
