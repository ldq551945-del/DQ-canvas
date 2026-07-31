import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("useCreateAgent submission retry", () => {
    it("reuses the original request and keeps attachments on the original user message", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/(user)/create/use-create-agent.ts"), "utf8");
        const executeStart = source.indexOf("const executeSubmission");
        const submitStart = source.indexOf("const submit =", executeStart);
        const retryStart = source.indexOf("const retrySubmission", submitStart);
        const executeSource = source.slice(executeStart, submitStart);
        const submitSource = source.slice(submitStart, retryStart);
        const retrySource = source.slice(retryStart, source.indexOf("const cancel", retryStart));

        expect(executeSource).toContain("clientRequestId: snapshot.clientRequestId");
        expect(submitSource).toContain("metadata: { assetIds }");
        expect(submitSource).toContain("setSelectedAssetIds((current) => current.filter");
        expect(retrySource).toContain("failedSubmissionsRef.current.get(assistantMessageId)");
        expect(retrySource).toContain("executeSubmission(snapshot)");
        expect(retrySource).not.toContain("setMessages((current) => [");
    });

    it("retries a failed planning run through the existing server run", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/(user)/create/use-create-agent.ts"), "utf8");
        const retryStart = source.indexOf("const retryRun");
        const retrySource = source.slice(retryStart, source.indexOf("const renameConversation", retryStart));

        expect(retrySource).toContain('controlCreativeAgentRun(runId, "retry")');
        expect(retrySource).toContain("setRunDetails");
        expect(retrySource).toContain("watchRun(result.run, assistantMessage.id");
        expect(retrySource).not.toContain("createCreativeAgentRun");
    });
});
