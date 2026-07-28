import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), getProject: vi.fn(), updateProject: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/canvas-project-service", () => ({
    canvasProjectError: vi.fn(),
    getCanvasProjectForUser: mocks.getProject,
    updateCanvasProjectForUser: mocks.updateProject,
}));

import { GET } from "./route";

describe("canvas project detail route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "user-one" });
        mocks.getProject.mockResolvedValue({ id: "canvas-one", nodes: [], connections: [] });
    });

    it("loads one owned project detail", async () => {
        const response = await GET(new Request("http://localhost/api/canvas/projects/canvas-one"), { params: Promise.resolve({ id: "canvas-one" }) });

        expect(mocks.getProject).toHaveBeenCalledWith("user-one", "canvas-one");
        expect(await response.json()).toEqual({ code: 0, data: { project: { id: "canvas-one", nodes: [], connections: [] } }, msg: "OK" });
    });
});
