import { describe, expect, it } from "vitest";

import { imagePreviewUrl, originalImageDownloadUrl, originalImageExtension } from "./media-image-url";

describe("media image urls", () => {
    it("builds bounded WebP previews while preserving signed query values", () => {
        expect(imagePreviewUrl("/api/reference-assets/permanent/file.png?expires=1&signature=test", 4096)).toBe("/api/reference-assets/permanent/file.png?expires=1&signature=test&format=webp&width=2048");
    });

    it("builds original-file downloads from a preview url", () => {
        expect(originalImageDownloadUrl("/api/generation-log-assets/file.jpg?format=webp&width=960")).toBe("/api/generation-log-assets/file.jpg?download=original");
        expect(originalImageExtension("/api/generation-log-assets/file.jpeg?download=original")).toBe("jpeg");
        expect(originalImageExtension("data:image/webp;base64,AAAA")).toBe("webp");
    });

    it("does not rewrite unrelated urls", () => {
        expect(imagePreviewUrl("https://cdn.example.com/file.png")).toBe("https://cdn.example.com/file.png");
        expect(imagePreviewUrl("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    });
});
