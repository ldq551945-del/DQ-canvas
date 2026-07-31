import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), getTextTask: vi.fn(), recover: vi.fn() }));

vi.mock("next/server", async (importOriginal) => {
    const actual = await importOriginal<typeof import("next/server")>();
    return { ...actual, after: vi.fn() };
});
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/server/text-task-store", () => ({ getTextTask: mocks.getTextTask, transitionTextTask: vi.fn() }));
vi.mock("@/lib/server/generation-task-recovery-service", () => ({ runGenerationTaskRecoveryBatch: mocks.recover }));
vi.mock("@/lib/server/internal-origin", () => ({ resolveInternalOrigin: vi.fn(() => "http://localhost") }));
vi.mock("@/lib/server/points-response", () => ({ pointsResponseHeaders: vi.fn(() => new Headers()) }));
vi.mock("@/lib/server/generation-channel", () => ({ generationModelId: vi.fn(() => "text-model") }));

import { after } from "next/server";
import { GET } from "./route";

describe("GET /api/text-tasks/[id]", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.currentUser.mockResolvedValue({ id: "user", role: "user" });
        mocks.getTextTask.mockResolvedValue({ id: "text-one", userId: "user", status: "running", executionPhase: "polling", config: { model: "text-model" } });
    });

    it("schedules a low-cost recovery wakeup for a running task", async () => {
        const response = await GET(new Request("http://localhost/api/text-tasks/text-one"), { params: Promise.resolve({ id: "text-one" }) });

        expect(response.status).toBe(200);
        expect(after).toHaveBeenCalledOnce();
    });

    it("does not wake a completed task", async () => {
        mocks.getTextTask.mockResolvedValue({ id: "text-one", userId: "user", status: "success", executionPhase: "completed", config: { model: "text-model" } });

        await GET(new Request("http://localhost/api/text-tasks/text-one"), { params: Promise.resolve({ id: "text-one" }) });

        expect(after).not.toHaveBeenCalled();
    });
});
