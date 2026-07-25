import { describe, expect, it } from "vitest";

import { normalizeDramaVisualReviewInput } from "./drama-visual-review";

describe("normalizeDramaVisualReviewInput", () => {
    it("keeps only reviewable server or https storyboard images", () => {
        const result = normalizeDramaVisualReviewInput({
            project: { title: "短剧", summary: "悬疑", style: "现实电影感", ratio: "9:16" },
            episode: {
                title: "第 1 集",
                shots: [
                    { id: "shot-one", title: "发现", imagePrompt: "雨夜", storyboardImageUrl: "/api/media-assets/one", storyboardEndImageUrl: "https://example.com/end.png" },
                    { id: "shot-two", title: "无图", storyboardImageUrl: "blob:expired" },
                ],
            },
        });

        expect(result.tasks).toEqual([expect.objectContaining({ id: "shot-one", imageUrls: ["/api/media-assets/one", "https://example.com/end.png"] })]);
        expect(result.foundation.direction.avoid).toContain("轴线与视线错误");
    });
});
