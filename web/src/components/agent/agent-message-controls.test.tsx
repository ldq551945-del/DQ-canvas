import { renderToStaticMarkup } from "react-dom/server";
import { App } from "antd";
import { describe, expect, it, vi } from "vitest";

import { agentMediaDownloadName } from "./agent-media-download";
import { formatAgentMessageText } from "./agent-message-format";
import { AgentMediaPreview } from "./agent-media-preview";
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
        const image = renderToStaticMarkup(
            <App>
                <AgentMediaPreview type="image" url="/generated/image.png" title="生成图片" fit="contain" />
            </App>,
        );
        const video = renderToStaticMarkup(
            <App>
                <AgentMediaPreview type="video" url="/generated/video.mp4" title="生成视频" />
            </App>,
        );

        expect(image).toContain("查看大图");
        expect(image).toContain('src="/generated/image.png"');
        expect(image).toContain("object-contain");
        expect(image).toContain("max-h-[min(42dvh,360px)]");
        expect(image).not.toContain("object-cover");
        expect(video).toContain('aria-label="打开视频：生成视频"');
        expect(video).toContain('src="/generated/video.mp4"');
    });

    it("builds safe download names and hides upstream JSON errors", () => {
        expect(agentMediaDownloadName("image", "小狗/竖版", "/generated/image.webp?token=1")).toBe("小狗-竖版.webp");
        expect(agentMediaDownloadName("video", "短片.mp4", "/generated/video.mp4")).toBe("短片.mp4");
        expect(formatAgentMessageText('{"error":{"message":"/backend-anon/conversation failed: status=403"}}')).toBe("当前模型暂不可用，请切换模型或稍后重试。");
        expect(formatAgentMessageText('{"code":400,"data":null,"msg":"积分不足，无法生成"}')).toBe("积分不足");
    });
});
