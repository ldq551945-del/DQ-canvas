import { renderToStaticMarkup } from "react-dom/server";
import { App } from "antd";
import { describe, expect, it, vi } from "vitest";

import { agentMediaDownloadName } from "./agent-media-download";
import { formatAgentMessageText } from "./agent-message-format";
import { agentMediaPreviewPopupStyles, AgentMediaPreview } from "./agent-media-preview";
import { AgentMessageActions } from "./agent-message-actions";

describe("agent message controls", () => {
    it("shows copy for every message and edit only for user messages", () => {
        const userActions = renderToStaticMarkup(
            <App>
                <AgentMessageActions text="生成一张海报" onEdit={vi.fn()} />
            </App>,
        );
        const assistantActions = renderToStaticMarkup(
            <App>
                <AgentMessageActions text="海报已经生成" downloads={[{ type: "image", url: "/generated/image.png", title: "生成图片" }]} />
            </App>,
        );

        expect(userActions).toContain('aria-label="复制消息"');
        expect(userActions).toContain('aria-label="编辑消息"');
        expect(assistantActions).toContain('aria-label="复制消息"');
        expect(assistantActions).toContain('aria-label="下载图片"');
        expect(assistantActions).not.toContain('aria-label="编辑消息"');
    });

    it("renders clickable image and video preview entries", () => {
        const onDimensions = vi.fn();
        const image = renderToStaticMarkup(
            <App>
                <AgentMediaPreview type="image" url="/generated/image.png" title="生成图片" fit="contain" onDimensions={onDimensions} />
            </App>,
        );
        const video = renderToStaticMarkup(
            <App>
                <AgentMediaPreview type="video" url="/generated/video.mp4" title="生成视频" fit="contain" />
            </App>,
        );

        expect(image).toContain("查看大图");
        expect(image).toContain('src="/generated/image.png"');
        expect(image).toContain("object-contain");
        expect(image).toContain("!size-full object-contain");
        expect(image).not.toContain("object-cover");
        expect(agentMediaPreviewPopupStyles.popup.root).toMatchObject({ position: "fixed", inset: 0, width: "100vw", height: "100dvh" });
        expect(agentMediaPreviewPopupStyles.popup.mask).toMatchObject({ position: "fixed", inset: 0 });
        expect(agentMediaPreviewPopupStyles.popup.body).toMatchObject({ position: "fixed", inset: 0, alignItems: "center", justifyContent: "center" });
        expect(image).not.toContain("rootClassName");
        expect(video).toContain('aria-label="打开视频：生成视频"');
        expect(video).toContain('src="/generated/video.mp4"');
        expect(video).toContain("object-contain");
        expect(video).not.toContain("object-cover");
    });

    it("builds safe download names and hides upstream JSON errors", () => {
        const imageName = agentMediaDownloadName("image", "小狗/竖版", "/generated/image.webp?token=1");
        const videoName = agentMediaDownloadName("video", "短片.mp4", "/generated/video.mp4");
        expect(imageName).toMatch(/^\d{8}-\d{6}-[a-f0-9]{8}\.png$/);
        expect(videoName).toMatch(/^\d{8}-\d{6}-[a-f0-9]{8}\.mp4$/);
        expect(agentMediaDownloadName("video", "短片", "/api/reference-assets/video.mp4", "video/quicktime")).toMatch(/^\d{8}-\d{6}-[a-f0-9]{8}\.mov$/);
        expect(agentMediaDownloadName("image", "海报.webp", "/api/reference-assets/image.webp", "image/png")).toMatch(/^\d{8}-\d{6}-[a-f0-9]{8}\.png$/);
        expect(imageName).not.toBe(videoName);
        expect(formatAgentMessageText('{"error":{"message":"/backend-anon/conversation failed: status=403"}}')).toBe("当前模型暂不可用，请切换模型或稍后重试。");
        expect(formatAgentMessageText('{"code":400,"data":null,"msg":"积分不足，无法生成"}')).toBe("积分不足");
    });
});
