import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { compactMetadata } from "./canvas-assistant-elements";

describe("Canvas Agent current-turn references", () => {
    it("renders the current-turn references before the user text", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/(user)/canvas/components/canvas-assistant-panel.tsx"), "utf8");
        const messageSource = source.slice(source.indexOf("messages.map((message)"), source.indexOf("<AgentChatComposer"));

        expect(messageSource.indexOf("<MessageReferences")).toBeGreaterThanOrEqual(0);
        expect(messageSource.indexOf("<MessageReferences")).toBeLessThan(messageSource.indexOf("<AgentChatMessage"));
    });

    it("keeps an uploaded canvas image as a stable Run reference URL", () => {
        expect(
            compactMetadata({
                content: "/api/reference-assets/permanent/2026/07/28/images/person.png",
                storageKey: "permanent/2026/07/28/images/person.png",
                mimeType: "image/png",
            }),
        ).toMatchObject({ url: "/api/reference-assets/permanent/2026/07/28/images/person.png" });
    });

    it("preserves the generation-media scope instead of rebuilding the image as a reference upload", () => {
        expect(
            compactMetadata({
                content: "/api/generation-log-assets/permanent/2026/07/28/images/person.png",
                storageKey: "permanent/2026/07/28/images/person.png",
            }),
        ).toMatchObject({ url: "/api/generation-log-assets/permanent/2026/07/28/images/person.png" });
    });
});
