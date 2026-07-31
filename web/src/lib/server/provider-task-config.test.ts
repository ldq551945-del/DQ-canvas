import { describe, expect, it } from "vitest";

import {
    assertReferenceCapabilities,
    assertReferenceUrls,
    buildProviderRequest,
    buildVideoProviderRequest,
    isProviderBusinessError,
    providerQueryPaths,
    providerTaskPath,
    readProviderError,
    readProviderString,
    videoPollingPolicy,
} from "./provider-task-config";

describe("provider task config", () => {
    it("uses the documented slower polling window for GlobalAiOpc video tasks only", () => {
        expect(videoPollingPolicy(true)).toEqual({ attempts: 40, intervalMs: 30_000 });
        expect(videoPollingPolicy(false)).toEqual({ attempts: 180, intervalMs: 2_500 });
    });

    it("renders JSON request templates without converting arrays and numbers to strings", () => {
        expect(buildProviderRequest('{"model":"{{model}}","duration":"{{duration}}","images":"{{images}}"}', {}, { model: "video-v1", duration: 10, images: ["a", "b"] })).toEqual({ model: "video-v1", duration: 10, images: ["a", "b"] });
    });

    it("removes empty optional reference placeholders and containers", () => {
        const template = '{"model":"{{model}}","image":"{{image}}","images":"{{images}}","reference_images":["{{image}}"],"referenceVideos":["https://..."],"ref_assets":[{"type":"image","url":"{{image}}"}],"metadata":{"label":""}}';

        expect(buildProviderRequest(template, {}, { model: "video-v1", image: "", images: [] })).toEqual({ model: "video-v1", metadata: { label: "" } });
    });

    it("fills detected video template examples with the current parameters and reference image", () => {
        const template = '{"model":"{{model}}","prompt":"{{prompt}}","duration":5,"ratio":"16:9","image":"https://...","images":["https://..."]}';

        expect(buildVideoProviderRequest(template, {}, { model: "video-v1", prompt: "animate", duration: 10, ratio: "9:16", image: "https://cdn.example.com/reference.jpg", images: [] })).toEqual({
            model: "video-v1",
            prompt: "animate",
            duration: 10,
            ratio: "9:16",
            image: "https://cdn.example.com/reference.jpg",
        });
    });

    it("resolves configured query and nested result fields", () => {
        expect(providerQueryPaths({ queryPath: "/tasks/{{taskId}}" } as never, "task 1", [])).toEqual(["/tasks/task%201"]);
        expect(providerQueryPaths({ queryPath: "/result/:task_id" } as never, "video_123", [])).toEqual(["/result/video_123"]);
        expect(providerQueryPaths({ queryPath: "/agnesapi?video_id=:task_id" } as never, "video 123", [])).toEqual(["/agnesapi?video_id=video%20123"]);
        expect(readProviderString({ data: { output: { url: "https://cdn.example.com/result.mp3" } } }, "data.output.url", ["url"])).toBe("https://cdn.example.com/result.mp3");
        expect(readProviderString({ result: { data: [{ url: "/api/v1/gen/cached/generated/result.mp4" }] } }, "result.data[0].url / video_url / url", ["video_url", "url"])).toBe("/api/v1/gen/cached/generated/result.mp4");
    });

    it("renders documented cancellation paths with encoded task ids", () => {
        expect(providerTaskPath("/jobs/:task_id/cancel", "task 1")).toBe("/jobs/task%201/cancel");
        expect(providerTaskPath("/jobs?task_id={{taskId}}", "task 1")).toBe("/jobs?task_id=task%201");
    });

    it("recognizes business errors returned with an HTTP 200 response", () => {
        const payload = { code: "204", msg: "登录验证失败" };
        expect(isProviderBusinessError(payload)).toBe(true);
        expect(readProviderError(payload)).toBe("登录验证失败");
        expect(isProviderBusinessError({ id: "video_123", status: "queued", error: null })).toBe(false);
    });

    it("rejects reference media disabled by the backend channel", () => {
        const config = { supportsReferenceImage: true, supportsReferenceVideo: false, supportsReferenceAudio: false } as never;
        expect(() => assertReferenceCapabilities(config, [{ type: "image" }])).not.toThrow();
        expect(() => assertReferenceCapabilities(config, [{ type: "video" }])).toThrow("当前渠道未启用参考视频能力");
        expect(() => assertReferenceCapabilities(config, [{ type: "audio" }])).toThrow("当前渠道未启用参考音频能力");
    });

    it("rejects loopback assets when the provider requires public reference URLs", () => {
        const config = { referenceRule: "参考图必须使用公网 URL" } as never;
        expect(() => assertReferenceUrls(config, [{ url: "http://127.0.0.1:3000/api/reference-assets/test.jpg" }])).toThrow("站内参考素材");
        expect(() => assertReferenceUrls(config, [{ url: "https://cdn.example.com/reference.jpg" }])).not.toThrow();
    });

    it("requires a short-lived signature before sending a protected reference asset upstream", () => {
        const config = { referenceRule: "参考图必须使用公网 URL" } as never;
        expect(() => assertReferenceUrls(config, [{ url: "https://drama.example/api/reference-assets/temporary/2026/07/25/images/file.png" }])).toThrow("站内参考素材");
        expect(() => assertReferenceUrls(config, [{ url: "https://drama.example/api/reference-assets/temporary/2026/07/25/images/file.png?expires=1&signature=test" }])).toThrow("站内参考素材");
        expect(() => assertReferenceUrls(config, [{ url: "https://drama.example/api/reference-assets/temporary/2026/07/25/images/file.png?purpose=provider-read&expires=1&signature=test" }])).not.toThrow();
    });
});
