import { beforeEach, describe, expect, it, vi } from "vitest";

import { listGenerationLogs } from "@/services/api/generation-logs";
import { readServerImageLogPage, readServerImageLogs } from "./image-workbench-records";
import { readServerVideoLogPage, readServerVideoLogs } from "../video/video-workbench-records";

vi.mock("@/services/api/generation-logs", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/api/generation-logs")>()),
    listGenerationLogs: vi.fn(),
}));

describe("workbench history loading", () => {
    beforeEach(() => {
        vi.mocked(listGenerationLogs).mockReset();
    });

    it("propagates image history failures instead of reporting an empty history", async () => {
        vi.mocked(listGenerationLogs).mockRejectedValueOnce(new Error("image history unavailable"));

        await expect(readServerImageLogs()).rejects.toThrow("image history unavailable");
    });

    it("propagates video history failures instead of reporting an empty history", async () => {
        vi.mocked(listGenerationLogs).mockRejectedValueOnce(new Error("video history unavailable"));

        await expect(readServerVideoLogs()).rejects.toThrow("video history unavailable");
    });

    it("still accepts a successful empty history response", async () => {
        vi.mocked(listGenerationLogs).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });

        await expect(readServerImageLogs()).resolves.toEqual([]);
        await expect(readServerVideoLogs()).resolves.toEqual([]);
    });

    it("passes explicit pages through for image and video history", async () => {
        vi.mocked(listGenerationLogs).mockResolvedValueOnce({ items: [], total: 45, page: 2, pageSize: 20 }).mockResolvedValueOnce({ items: [], total: 31, page: 3, pageSize: 10 });

        await expect(readServerImageLogPage({ page: 2, pageSize: 20 })).resolves.toEqual({ items: [], total: 45, page: 2, pageSize: 20 });
        await expect(readServerVideoLogPage({ page: 3, pageSize: 10 })).resolves.toEqual({ items: [], total: 31, page: 3, pageSize: 10 });
        expect(listGenerationLogs).toHaveBeenNthCalledWith(1, { kind: "image", source: "image-workbench", page: 2, pageSize: 20 });
        expect(listGenerationLogs).toHaveBeenNthCalledWith(2, { kind: "video", source: "video-workbench", page: 3, pageSize: 10 });
    });
});
