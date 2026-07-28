import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CanvasNodeType } from "../types";
import { assistantMessageToChatMessage, compactMetadata, compactSnapshot } from "./canvas-assistant-elements";

describe("Canvas Agent current-turn references", () => {
    it("renders the current-turn references before the user text", async () => {
        const item = assistantMessageToChatMessage({ id: "message", role: "user", text: "修改颜色", references: [{ id: "reference", type: CanvasNodeType.Image, title: "参考图", dataUrl: "/api/reference-assets/reference.webp" }] });
        expect(item.attachments).toEqual([{ id: "reference", name: "参考图", url: "/api/reference-assets/reference.webp" }]);

        const source = await readFile(resolve(process.cwd(), "src/app/(user)/canvas/components/canvas-agent-chat-ui.tsx"), "utf8");
        const userMessageStart = source.indexOf("if (isUser)");
        const messageSource = source.slice(userMessageStart, source.indexOf("return (", source.indexOf("return (", userMessageStart) + 1));

        expect(messageSource.indexOf("<AgentMessageAttachments")).toBeGreaterThanOrEqual(0);
        expect(messageSource.indexOf("<AgentMessageAttachments")).toBeLessThan(messageSource.indexOf("item.text"));
        expect(messageSource.indexOf("<AgentUserAvatar")).toBeGreaterThan(messageSource.indexOf("item.text"));
    });

    it("clears submitted references before creating the backend run", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/(user)/canvas/components/canvas-assistant-panel.tsx"), "utf8");
        const sendSource = source.slice(source.indexOf("const sendMessage"), source.indexOf("const waitForBackendAgent"));

        expect(sendSource.indexOf("setRemovedReferenceIds")).toBeGreaterThanOrEqual(0);
        expect(sendSource.indexOf("setRemovedReferenceIds")).toBeLessThan(sendSource.indexOf('fetch("/api/agent/runs"'));
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

    it("keeps the current custom image dimensions in the backend Run snapshot", () => {
        expect(
            compactSnapshot({
                projectId: "canvas-one",
                title: "画布",
                imageSize: "1824x1024",
                nodes: [],
                connections: [],
                selectedNodeIds: [],
                viewport: { x: 0, y: 0, k: 1 },
            }),
        ).toMatchObject({ imageSize: "1824x1024" });
    });
});
