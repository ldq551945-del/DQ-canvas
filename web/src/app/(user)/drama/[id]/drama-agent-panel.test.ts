import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Drama project Agent references", () => {
    it("renders uploaded references above the user message text", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/(user)/drama/[id]/drama-agent-panel.tsx"), "utf8");
        const messageSource = source.slice(source.indexOf("messages.map((message)"), source.indexOf("<div ref={endRef}"));

        expect(messageSource).toContain("messageAssetIds(message)");
        expect(messageSource.indexOf("<DramaMessageReferences")).toBeLessThan(messageSource.indexOf("{displayContent}"));
    });

    it("reuses the original request snapshot when an initial submission is retried", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/(user)/drama/[id]/drama-agent-panel.tsx"), "utf8");

        expect(source).toContain("clientRequestId: submission.clientRequestId");
        expect(source).toContain("failedSubmissionsRef.current.get(assistantMessageId)");
        expect(source).toContain('aria-label="重试本次项目 Agent 请求"');
        expect(source).toContain("metadata: { assetIds }");
        expect(source).toMatch(/messageAssetIds\(message\)\s*\.filter/);
    });
});
