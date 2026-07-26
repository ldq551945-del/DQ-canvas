import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getCurrentUser: vi.fn(),
    getWorkbenchSessionForUser: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/creative-runtime-service", () => ({
    CreativeRuntimeServiceError: class CreativeRuntimeServiceError extends Error {
        constructor(
            message: string,
            public readonly status: number,
        ) {
            super(message);
        }
    },
    getConversationForUser: vi.fn(),
    getWorkbenchSessionForUser: mocks.getWorkbenchSessionForUser,
    updateConversationForUser: vi.fn(),
}));

import { GET } from "./route";

describe("creative workbench conversation detail route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "user-one" });
        mocks.getWorkbenchSessionForUser.mockResolvedValue({ id: "conversation-one", recordId: "record-one", messages: [], hasMore: false });
    });

    it("loads one owned workbench conversation on demand", async () => {
        const response = await GET(new Request("http://localhost/api/creative/conversations/conversation-one?view=workbench&workspace=video"), { params: Promise.resolve({ id: "conversation-one" }) });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(mocks.getWorkbenchSessionForUser).toHaveBeenCalledWith("user-one", "conversation-one", "video", 0);
        expect(payload.data.session).toEqual(expect.objectContaining({ id: "conversation-one", recordId: "record-one" }));
    });
});
