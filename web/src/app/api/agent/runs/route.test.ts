import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    after: vi.fn(),
    getCurrentUser: vi.fn(),
    getAuthSettings: vi.fn(),
    checkRateLimit: vi.fn(),
    countActiveStoredGenerationTasks: vi.fn(),
    withGenerationConcurrencyLimit: vi.fn(),
    runGenerationTaskRecoveryBatch: vi.fn(),
    scheduleGenerationTask: vi.fn(),
    createAgentRun: vi.fn(),
    getAgentRunByClientRequestId: vi.fn(),
    listAgentRuns: vi.fn(),
    resolveLogicalModelCandidates: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: mocks.after }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/auth/store", () => ({ getAuthSettings: mocks.getAuthSettings }));
vi.mock("@/lib/server/security", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/server/generation-task-store", () => ({ withGenerationConcurrencyLimit: mocks.withGenerationConcurrencyLimit }));
vi.mock("@/lib/server/generation-task-recovery-service", () => ({ runGenerationTaskRecoveryBatch: mocks.runGenerationTaskRecoveryBatch }));
vi.mock("@/lib/server/generation-task-scheduler", () => ({ scheduleGenerationTask: mocks.scheduleGenerationTask }));
vi.mock("@/lib/server/agent-run-store", () => ({ createAgentRun: mocks.createAgentRun, getAgentRunByClientRequestId: mocks.getAgentRunByClientRequestId, listAgentRuns: mocks.listAgentRuns }));
vi.mock("@/lib/server/internal-origin", () => ({ resolveInternalOrigin: vi.fn(() => "http://localhost") }));
vi.mock("@/lib/server/logical-model-router", () => ({ resolveLogicalModelCandidates: mocks.resolveLogicalModelCandidates }));

import { POST } from "./route";

describe("POST /api/agent/runs", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "user" });
        mocks.getAuthSettings.mockResolvedValue({ generationConcurrency: { agent: 2 } });
        mocks.checkRateLimit.mockReturnValue({ allowed: true });
        mocks.countActiveStoredGenerationTasks.mockResolvedValue(0);
        mocks.withGenerationConcurrencyLimit.mockImplementation(async (_userId, _type, _staleMs, _limit, handler) => handler());
        mocks.getAgentRunByClientRequestId.mockResolvedValue(null);
        mocks.resolveLogicalModelCandidates.mockReturnValue([]);
    });

    it("requires authentication", async () => {
        mocks.getCurrentUser.mockResolvedValue(null);
        const response = await POST(request(validInput()));
        expect(response.status).toBe(401);
    });

    it("enforces chat surface invariants before creating a run", async () => {
        const response = await POST(request({ ...validInput(), projectId: "project" }));
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ msg: "普通对话不接受项目或快照" });
        expect(mocks.createAgentRun).not.toHaveBeenCalled();
    });

    it("returns an existing idempotent run before rate and concurrency checks", async () => {
        mocks.getAgentRunByClientRequestId.mockResolvedValue({ id: "existing-run", userId: "user", clientRequestId: "request-one" });
        const response = await POST(request({ ...validInput(), agentModelId: "removed-planner" }));
        expect(await response.json()).toMatchObject({ data: { run: { id: "existing-run" }, created: false } });
        expect(mocks.checkRateLimit).not.toHaveBeenCalled();
        expect(mocks.getAuthSettings).not.toHaveBeenCalled();
        expect(mocks.resolveLogicalModelCandidates).not.toHaveBeenCalled();
        expect(mocks.withGenerationConcurrencyLimit).not.toHaveBeenCalled();
        expect(mocks.createAgentRun).not.toHaveBeenCalled();
    });

    it("rejects an unavailable explicitly selected Agent model before creating a run", async () => {
        const settings = { generationConcurrency: { agent: 2 }, logicalModels: [], systemChannels: [] };
        mocks.getAuthSettings.mockResolvedValue(settings);

        const response = await POST(request({ ...validInput(), agentModelId: " removed-planner " }));

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ msg: "所选智能体模型当前不可用，请重新选择" });
        expect(mocks.resolveLogicalModelCandidates).toHaveBeenCalledWith(settings, "text", "removed-planner");
        expect(mocks.withGenerationConcurrencyLimit).not.toHaveBeenCalled();
        expect(mocks.createAgentRun).not.toHaveBeenCalled();
    });

    it("creates and schedules a validated run once", async () => {
        const run = { id: "new-run", userId: "user", clientRequestId: "request-one" };
        mocks.createAgentRun.mockResolvedValue({ run, conversation: { id: "conversation" }, created: true });
        const response = await POST(request(validInput()));
        expect(await response.json()).toMatchObject({ data: { run: { id: "new-run" }, conversation: { id: "conversation" }, created: true } });
        expect(mocks.createAgentRun).toHaveBeenCalledWith("user", {
            ...validInput(),
            conversationId: undefined,
            projectId: undefined,
            skillIds: [],
            modelIds: [],
            agentModelId: undefined,
            snapshot: undefined,
        });
        expect(mocks.scheduleGenerationTask).toHaveBeenCalledWith("agent", "new-run", expect.objectContaining({ executionPhase: "created", nextPollAt: expect.any(Number), lastUpstreamStatus: "created" }));
        expect(mocks.after).toHaveBeenCalledWith(expect.any(Function));
    });

    it("passes a validated Agent model to run persistence", async () => {
        const settings = { generationConcurrency: { agent: 2 } };
        const run = { id: "new-run", userId: "user", clientRequestId: "request-one", requestedAgentModelId: "planner-pro" };
        mocks.getAuthSettings.mockResolvedValue(settings);
        mocks.resolveLogicalModelCandidates.mockReturnValue([{ logicalModelId: "planner-pro" }]);
        mocks.createAgentRun.mockResolvedValue({ run, conversation: { id: "conversation" }, created: true });

        const response = await POST(request({ ...validInput(), agentModelId: " planner-pro " }));

        expect(response.status).toBe(200);
        expect(mocks.createAgentRun).toHaveBeenCalledWith("user", expect.objectContaining({ agentModelId: "planner-pro" }));
    });
});

function request(body: unknown) {
    return new Request("http://localhost/api/agent/runs", { method: "POST", headers: { "content-type": "application/json", cookie: "session=test" }, body: JSON.stringify(body) });
}

function validInput() {
    return { clientRequestId: "request-one", surface: "chat", prompt: "生成一张图", assetIds: [] };
}
