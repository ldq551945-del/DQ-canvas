import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    downloadMediaToFile: vi.fn(),
    ffmpegAvailable: vi.fn(),
    runFfmpeg: vi.fn(),
    runFfprobe: vi.fn(),
    writeReferenceMediaFile: vi.fn(),
}));

vi.mock("@/lib/server/media-download", () => ({ downloadMediaToFile: mocks.downloadMediaToFile }));
vi.mock("@/lib/server/ffmpeg", () => ({ ffmpegAvailable: mocks.ffmpegAvailable, runFfmpeg: mocks.runFfmpeg, runFfprobe: mocks.runFfprobe }));
vi.mock("@/lib/server/reference-asset-store", () => ({ writeReferenceMediaFile: mocks.writeReferenceMediaFile }));

import { normalizeVideoResult } from "./video-result-normalizer";

describe("normalizeVideoResult", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.downloadMediaToFile.mockResolvedValue({ bytes: 1024, mimeType: "video/mp4" });
        mocks.ffmpegAvailable.mockResolvedValue(true);
        mocks.runFfmpeg.mockResolvedValue({ stdout: "", stderr: "" });
        mocks.writeReferenceMediaFile.mockResolvedValue({ token: "permanent/2026/07/19/videos/result.mp4", mimeType: "video/mp4", bytes: 512 });
    });

    it("trims an upstream 8 second video to the requested 5 seconds", async () => {
        mocks.runFfprobe.mockResolvedValueOnce({ stdout: "8.000000\n", stderr: "" }).mockResolvedValueOnce({ stdout: "5.000000\n", stderr: "" });

        const result = await normalizeVideoResult({ url: "/api/ai/system/video/_media?url=result", origin: "http://localhost", cookie: "session=test", requestedDurationSeconds: 5, ownerUserId: "user" });

        expect(mocks.runFfmpeg).toHaveBeenCalledWith(expect.arrayContaining(["-t", "5"]), expect.objectContaining({ timeoutMs: 10 * 60_000 }));
        expect(mocks.writeReferenceMediaFile.mock.calls[0][0]).toMatch(/normalized-video\.mp4$/);
        expect(result).toEqual({ url: "/api/reference-assets/permanent/2026/07/19/videos/result.mp4", mimeType: "video/mp4", durationMs: 5000 });
    });

    it("keeps an already matching result without re-encoding", async () => {
        mocks.downloadMediaToFile.mockResolvedValue({ bytes: 1024, mimeType: "video/webm" });
        mocks.runFfprobe.mockResolvedValue({ stdout: "5.040000\n", stderr: "" });

        const result = await normalizeVideoResult({ url: "/api/source.mp4", origin: "http://localhost", requestedDurationSeconds: 5, ownerUserId: "user" });

        expect(mocks.runFfmpeg).not.toHaveBeenCalled();
        expect(mocks.writeReferenceMediaFile.mock.calls[0][0]).toMatch(/source-video$/);
        expect(mocks.writeReferenceMediaFile).toHaveBeenCalledWith(expect.any(String), "video", "video/webm", true, expect.objectContaining({ ownerUserId: "user", source: "video-task" }));
        expect(result.durationMs).toBe(5040);
    });

    it("fails clearly instead of returning the wrong duration when FFmpeg is unavailable", async () => {
        mocks.runFfprobe.mockResolvedValue({ stdout: "8.000000\n", stderr: "" });
        mocks.ffmpegAvailable.mockResolvedValue(false);

        await expect(normalizeVideoResult({ url: "/api/source.mp4", origin: "http://localhost", requestedDurationSeconds: 5, ownerUserId: "user" })).rejects.toThrow("上游返回 8 秒");
        expect(mocks.writeReferenceMediaFile).not.toHaveBeenCalled();
    });
});
