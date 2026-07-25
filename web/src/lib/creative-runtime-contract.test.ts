import { describe, expect, it } from "vitest";

import { CreativeRuntimeInputError, isCreativeProjectHandoff, normalizeCreativeRunRequest } from "./creative-runtime-contract";

describe("normalizeCreativeRunRequest", () => {
    it("normalizes a chat request and deduplicates assets", () => {
        expect(normalizeCreativeRunRequest({ clientRequestId: " req-1 ", surface: "chat", prompt: " hello ", assetIds: ["a", "a", "b"], skillIds: ["character-design", "character-design"], modelIds: [" image-pro ", "image-pro", "video-pro"] })).toEqual({
            clientRequestId: "req-1",
            surface: "chat",
            prompt: "hello",
            assetIds: ["a", "b"],
            skillIds: ["character-design"],
            modelIds: ["image-pro", "video-pro"],
        });
    });

    it("requires projects for canvas and drama", () => {
        expect(() => normalizeCreativeRunRequest({ clientRequestId: "x", surface: "canvas", prompt: "draw" })).toThrow("画布标识不能为空");
        expect(() => normalizeCreativeRunRequest({ clientRequestId: "x", surface: "drama", prompt: "write" })).toThrow("短剧项目标识不能为空");
    });

    it("rejects project state on chat and oversized snapshots", () => {
        expect(() => normalizeCreativeRunRequest({ clientRequestId: "x", surface: "chat", projectId: "p", prompt: "hello" })).toThrow("普通对话不接受项目或快照");
        try {
            normalizeCreativeRunRequest({ clientRequestId: "x", surface: "canvas", projectId: "p", prompt: "draw", snapshot: { value: "x".repeat(513 * 1024) } });
            throw new Error("expected validation error");
        } catch (error) {
            expect(error).toBeInstanceOf(CreativeRuntimeInputError);
            expect((error as CreativeRuntimeInputError).status).toBe(413);
        }
    });
});

describe("isCreativeProjectHandoff", () => {
    it("accepts complete handoffs and rejects incomplete event payloads", () => {
        expect(
            isCreativeProjectHandoff({
                id: "handoff-one",
                sourceRunId: "run-one",
                conversationId: "conversation-one",
                surface: "canvas",
                title: "品牌画布",
                summary: "整理当前内容",
                assetIds: [],
                assets: [],
            }),
        ).toBe(true);
        expect(isCreativeProjectHandoff({ id: "handoff-one", surface: "canvas", title: "品牌画布", assets: [] })).toBe(false);
    });
});
