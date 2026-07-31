import { describe, expect, it } from "vitest";

import { GenerationTaskRequestError, isGenerationCapacityError } from "./generation-task-request-error";

describe("generation task request errors", () => {
    it("treats capacity and rate-limit responses as recoverable", () => {
        expect(isGenerationCapacityError(new GenerationTaskRequestError("当前用户生图任务已达到并发上限", 429))).toBe(true);
        expect(isGenerationCapacityError(new Error("生图请求过于频繁，请稍后重试"))).toBe(true);
    });

    it("does not retry terminal request errors", () => {
        expect(isGenerationCapacityError(new GenerationTaskRequestError("任务参数不完整", 400))).toBe(false);
        expect(isGenerationCapacityError(new Error("上游模型不支持当前参数"))).toBe(false);
    });
});
