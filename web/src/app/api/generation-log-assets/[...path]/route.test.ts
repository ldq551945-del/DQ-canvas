import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getCurrentUser: vi.fn(),
    getDataDir: vi.fn(),
    canAccess: vi.fn(),
    registration: vi.fn(),
    stream: vi.fn(),
    disposition: vi.fn(),
    rate: vi.fn(),
    externalRead: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/data-dir", () => ({ getServerDataDir: mocks.getDataDir }));
vi.mock("@/lib/server/generation-log-store", () => ({ canAccessGenerationAsset: mocks.canAccess }));
vi.mock("@/lib/server/local-media-registry", () => ({ getLocalMediaRegistration: mocks.registration }));
vi.mock("@/lib/server/local-media-response", () => ({
    createLocalMediaResponse: mocks.stream,
    mediaContentDisposition: mocks.disposition,
}));
vi.mock("@/lib/server/security", () => ({ checkLocalMediaRateLimit: mocks.rate, rateLimitHeaders: vi.fn(() => ({ "Retry-After": "60" })) }));
vi.mock("@/lib/server/object-storage-service", () => ({ createExternalMediaReadUrl: mocks.externalRead }));

import { GET } from "./route";

const context = { params: Promise.resolve({ path: ["permanent", "2026", "07", "20", "images", "file.png"] }) };

describe("generation log asset access", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "owner", role: "user" });
        mocks.getDataDir.mockReturnValue("C:/vozeb-data");
        mocks.canAccess.mockResolvedValue(true);
        mocks.registration.mockResolvedValue({ originalName: "uploaded-file.png" });
        mocks.rate.mockResolvedValue({ allowed: true, remaining: 239, resetAt: Date.now() + 60_000 });
        mocks.stream.mockResolvedValue(new Response("image"));
        mocks.disposition.mockReturnValue('inline; filename="uploaded-file.png"');
        mocks.externalRead.mockResolvedValue("https://storage.example/signed");
    });

    it("redirects an allowed object-backed asset", async () => {
        mocks.registration.mockResolvedValue({ originalName: "uploaded-file.png", storageProvider: "object", externalObjectKey: "bucket/file.png" });
        const response = await GET(new Request("http://localhost/api/generation-log-assets/permanent/2026/07/20/images/file.png"), context);
        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toBe("https://storage.example/signed");
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
        expect(mocks.stream).not.toHaveBeenCalled();
    });

    it("hides assets from another user", async () => {
        mocks.canAccess.mockResolvedValue(false);
        const response = await GET(new Request("http://localhost/api/generation-log-assets/permanent/2026/07/20/images/file.png"), context);
        expect(response.status).toBe(404);
        expect(mocks.stream).not.toHaveBeenCalled();
    });

    it("limits authenticated asset reads before opening the file", async () => {
        mocks.rate.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000 });
        const response = await GET(new Request("http://localhost/api/generation-log-assets/permanent/2026/07/20/images/file.png"), context);
        expect(response.status).toBe(429);
        expect(mocks.canAccess).not.toHaveBeenCalled();
        expect(mocks.stream).not.toHaveBeenCalled();
    });

    it("checks ownership and streams an allowed asset", async () => {
        const response = await GET(new Request("http://localhost/api/generation-log-assets/permanent/2026/07/20/images/file.png"), context);
        expect(response.status).toBe(200);
        expect(mocks.canAccess).toHaveBeenCalledWith("owner", "user", "/api/generation-log-assets/permanent/2026/07/20/images/file.png");
        expect(mocks.disposition).toHaveBeenCalledWith("inline", "uploaded-file.png");
        expect(mocks.stream).toHaveBeenCalled();
    });
});
