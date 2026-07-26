import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getCurrentUser: vi.fn(),
    listWorkbenchSessionsForUser: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/creative-runtime-service", () => ({
    createConversationForUser: vi.fn(),
    CreativeRuntimeServiceError: class CreativeRuntimeServiceError extends Error {
        constructor(
            message: string,
            public readonly status: number,
        ) {
            super(message);
        }
    },
    listConversationsForUser: vi.fn(),
    listWorkbenchSessionsForUser: mocks.listWorkbenchSessionsForUser,
}));

import { GET } from "./route";

describe("creative workbench conversation summaries route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "user-one" });
        mocks.listWorkbenchSessionsForUser.mockResolvedValue([
            { id: "one", title: "一", lastPrompt: "一", searchText: "一", updatedAt: 2 },
            { id: "two", title: "二", lastPrompt: "二", searchText: "二", updatedAt: 1 },
        ]);
    });

    it("returns one bounded summary page without expanding conversations", async () => {
        const response = await GET(new Request("http://localhost/api/creative/conversations?view=workbench&workspace=image&limit=1"));
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(mocks.listWorkbenchSessionsForUser).toHaveBeenCalledWith("user-one", "image", 2);
        expect(payload.data).toEqual({ sessions: [expect.objectContaining({ id: "one" })], hasMore: true });
    });

    it("rejects anonymous summary reads", async () => {
        mocks.getCurrentUser.mockResolvedValueOnce(null);
        const response = await GET(new Request("http://localhost/api/creative/conversations?view=workbench&workspace=image"));
        expect(response.status).toBe(401);
        expect(mocks.listWorkbenchSessionsForUser).not.toHaveBeenCalled();
    });
});
