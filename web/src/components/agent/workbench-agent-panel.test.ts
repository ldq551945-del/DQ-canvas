import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("workbench Agent conversation", () => {
    it("renders the current-turn reference above the user text", async () => {
        const source = await readFile(resolve(process.cwd(), "src/components/agent/workbench-agent-panel.tsx"), "utf8");
        const messageSource = source.slice(source.indexOf("messages.map((message)"), source.indexOf("function WorkbenchMessageAttachments"));

        expect(messageSource).toContain("<WorkbenchMessageAttachments");
        expect(messageSource.indexOf("<WorkbenchMessageAttachments")).toBeLessThan(messageSource.indexOf("<WorkbenchAgentProgressMessage"));
    });

    it("uses compact plain text messages instead of chat bubbles", async () => {
        const source = await readFile(resolve(process.cwd(), "src/components/agent/workbench-agent-panel.tsx"), "utf8");

        expect(source).toContain('message.role === "user" && "text-right text-stone-950 dark:text-stone-50"');
        expect(source).toContain('message.role === "assistant" && "text-stone-700 dark:text-stone-200"');
        expect(source).toContain('<div className="max-w-full">');
        expect(source).not.toContain('message.role === "user" ? "max-w-full bg-stone-900');
        expect(source).not.toContain('"rounded-2xl px-3.5 py-2.5 text-sm leading-6');
        expect(source).not.toContain('className="w-[340px] max-w-full"');
    });

    it("shows only the current Agent progress step", async () => {
        const source = await readFile(resolve(process.cwd(), "src/components/agent/workbench-agent-panel.tsx"), "utf8");
        const progressSource = source.slice(source.indexOf("function WorkbenchAgentProgressMessage"), source.indexOf("function WorkbenchAgentResponseMessage"));

        expect(progressSource).toContain('progress.phase === "planning" ? "思考中"');
        expect(progressSource).toContain('progress.phase === "submitting" ? "正在创建生成任务"');
        expect(progressSource).not.toContain("workbenchAgentProgressHeading");
        expect(progressSource).not.toContain("workbenchAgentProgressSteps");
        expect(progressSource).not.toContain("{message.text}</p>");
        expect(progressSource).not.toContain("steps.map((step)");
    });

    it("keeps image and video workbenches on the same conversation and placeholder components", async () => {
        const [imagePage, imagePanels, videoPage, videoPanels] = await Promise.all([
            readFile(resolve(process.cwd(), "src/app/(user)/image/page.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/app/(user)/image/image-workbench-panels.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/app/(user)/video/page.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/app/(user)/video/video-workbench-panels.tsx"), "utf8"),
        ]);

        expect(imagePage).toContain("<WorkbenchAgentConversation");
        expect(videoPage).toContain("<WorkbenchAgentConversation");
        expect(imagePanels).toContain('<WorkbenchGenerationPlaceholder kind="image"');
        expect(videoPanels).toContain('<WorkbenchGenerationPlaceholder kind="video"');
    });
});
