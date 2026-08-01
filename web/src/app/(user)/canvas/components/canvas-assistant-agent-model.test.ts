import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Canvas Agent text model selection", () => {
    it("submits the selected model and clears it when smart planning resumes", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/(user)/canvas/components/canvas-assistant-panel.tsx"), "utf8");

        expect(source).toContain("agentModelId: selectedAgentModelId || undefined");
        expect(source).toContain("agentModelId={selectedAgentModelId}");
        expect(source).toContain("onAgentModelChange={(model) =>");
        expect(source).toContain("agentModelDisabled={isRunning}");
        expect(source).toContain('setSelectedAgentModelId("")');
    });
});
