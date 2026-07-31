import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { canvasThemes } from "@/lib/canvas-theme";
import { AgentChatComposer } from "./canvas-agent-chat-ui";

const baseProps = {
    prompt: "换成紫毛",
    placeholder: "描述需求",
    theme: canvasThemes.light,
    onPromptChange: vi.fn(),
    onSubmit: vi.fn(),
};

describe("Canvas Agent image attachments", () => {
    it("shows an immediate upload preview and blocks submission until it is ready", () => {
        const markup = renderToStaticMarkup(<AgentChatComposer {...baseProps} attachments={[{ id: "upload", name: "clipboard-image.png", url: "blob:preview", status: "uploading" }]} onAddFiles={vi.fn()} onRemoveAttachment={vi.fn()} />);

        expect(markup).toContain('aria-label="clipboard-image.png 上传中"');
        expect(markup).toContain('aria-label="正在上传图片"');
        expect(markup).toMatch(/aria-label="发送"[^>]*disabled=""/);
    });

    it("keeps a failed preview in place with retry and remove actions", () => {
        const markup = renderToStaticMarkup(
            <AgentChatComposer {...baseProps} attachments={[{ id: "failed", name: "reference.png", url: "blob:failed", status: "failed", error: "上传失败" }]} onAddFiles={vi.fn()} onRetryAttachment={vi.fn()} onRemoveAttachment={vi.fn()} />,
        );

        expect(markup).toContain('aria-label="重试上传图片：reference.png"');
        expect(markup).toContain('aria-label="移除图片"');
        expect(markup).toContain('title="上传失败"');
        expect(markup).toMatch(/aria-label="发送"[^>]*disabled=""/);
    });
});
