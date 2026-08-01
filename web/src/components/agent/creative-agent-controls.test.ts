import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { creativeAgentModelCapabilities, groupCreativeAgentModels, type CreativeAgentModelOption } from "./creative-agent-controls";

describe("creative agent model categories", () => {
    it("keeps all media categories in a stable order and groups available models", () => {
        const models: CreativeAgentModelOption[] = [
            { id: "video-one", name: "视频一", capability: "video" },
            { id: "image-one", name: "图片一", capability: "image" },
            { id: "video-two", name: "视频二", capability: "video" },
        ];

        expect(creativeAgentModelCapabilities).toEqual(["image", "video", "audio"]);
        expect(groupCreativeAgentModels(models)).toEqual({ image: [models[1]], video: [models[0], models[2]], audio: [] });
    });

    it("keeps the Agent text model separate from media models", async () => {
        const source = await readFile(resolve(process.cwd(), "src/components/agent/creative-agent-controls.tsx"), "utf8");
        const controls = source.slice(source.indexOf("export function CreativeAgentControls"));

        expect(controls).toContain("<CreativeAgentTextModelPicker");
        expect(controls.indexOf("<CreativeAgentTextModelPicker")).toBeGreaterThan(controls.indexOf("<Lightbulb"));
        expect(controls.indexOf("<CreativeAgentTextModelPicker")).toBeLessThan(controls.indexOf("<Orbit"));
        expect(controls).toContain("disabled={agentModelDisabled}");
        expect(source).toContain('selectableModelsByCapability(config, "text")');
        expect(source).toContain("currentModel ? <ModelIcon model={`${currentModel} ${currentModelLabel}`} />");
    });
});
