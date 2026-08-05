import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "../types";
import { CanvasNode } from "./canvas-node";

const imageNode: CanvasNodeData = {
    id: "generated-image",
    type: CanvasNodeType.Image,
    title: "生成图片",
    position: { x: 120, y: 80 },
    width: 320,
    height: 320,
    metadata: { content: "/api/reference-assets/permanent/generated-image.png" },
};

const noop = () => undefined;

function renderImageNode(overrides: Partial<React.ComponentProps<typeof CanvasNode>> = {}) {
    return renderToStaticMarkup(
        <CanvasNode
            data={imageNode}
            scale={1}
            isSelected={false}
            isRelated={false}
            isFocusRelated={false}
            isConnectionTarget={false}
            isConnecting={false}
            showPanel={false}
            showImageInfo={false}
            onMouseDown={noop}
            onHoverStart={noop}
            onHoverEnd={noop}
            onConnectStart={noop}
            onResize={noop}
            onContentChange={noop}
            onContextMenu={noop}
            {...overrides}
        />,
    );
}

describe("CanvasNode image border", () => {
    beforeEach(() => useThemeStore.setState({ theme: "light" }));

    it("uses the themed card border for an idle generated image", () => {
        const markup = renderImageNode();

        expect(markup).toContain(`border-color:${canvasThemes.light.node.stroke}`);
        expect(markup).toContain("rounded-3xl border-2");
        expect(markup).toContain("overflow-hidden rounded-3xl");
        expect(markup).toContain("/api/reference-assets/permanent/generated-image.png?format=webp&amp;width=1920");
    });

    it("keeps the blue active border when the image is selected", () => {
        expect(renderImageNode({ isSelected: true })).toContain("border-color:#2f80ff");
    });

    it("keeps the muted highlight for a related image", () => {
        expect(renderImageNode({ isRelated: true })).toContain(`border-color:${canvasThemes.light.node.muted}`);
    });

    it("does not apply the related highlight to a batch child", () => {
        const batchChild = { ...imageNode, metadata: { ...imageNode.metadata, batchRootId: "batch-root" } };

        const markup = renderImageNode({ data: batchChild, isRelated: true });

        expect(markup).toContain(`class="relative h-full w-full overflow-visible rounded-3xl border-2" style="background:transparent;border-color:${canvasThemes.light.node.stroke}"`);
    });

    it("shows the themed lock badge and removes resize handles for a locked node", () => {
        const markup = renderImageNode({ data: { ...imageNode, metadata: { ...imageNode.metadata, locked: true } }, isSelected: true, scale: 0.5 });

        expect(markup).toContain('aria-label="节点已锁定"');
        expect(markup).toContain(`background:${canvasThemes.light.toolbar.panel}`);
        expect(markup).toContain("data-canvas-node-lock-badge");
        expect(markup).toContain('data-lock-badge-screen-size="28.8"');
        expect(markup).toContain('stroke-width="2.25"');
        expect(markup).toContain("width:28.8px;height:28.8px;right:12.8px;top:12.8px;transform:scale(2);transform-origin:top right");
        expect(markup).not.toContain("cursor-nwse-resize");
        expect(markup).not.toContain("cursor-nesw-resize");
    });
});

describe("CanvasNode connection handles", () => {
    beforeEach(() => useThemeStore.setState({ theme: "light" }));

    it("uses generous hit areas around restrained vertical capsule handles", () => {
        const markup = renderImageNode({ isSelected: true, isConnecting: true });

        expect(markup).toContain('data-canvas-connection-handle="left"');
        expect(markup).toContain('data-canvas-connection-handle="right"');
        expect(markup).toContain('data-canvas-connection-plus="left"');
        expect(markup).toContain('data-canvas-connection-plus="right"');
        expect(markup).toContain("h-[72px] w-[56px]");
        expect(markup).toContain("h-[38px] w-[7px] rounded-full");
        expect(markup).toContain('aria-label="连接到此节点"');
        expect(markup).toContain('aria-label="从此节点连接"');
    });

    it("keeps rail hit targets screen-sized and respects node connection capabilities", () => {
        const scaled = renderImageNode({ isSelected: true, scale: 0.5 });
        const inputOnly = renderImageNode({ isSelected: true, showSourceHandle: false });

        expect(scaled).toContain("width:112px;height:min(100%, 144px)");
        expect(inputOnly).toContain('data-canvas-connection-handle="left"');
        expect(inputOnly).toContain("pointer-events-none opacity-0");
    });

    it("keeps only the active source or target plus linked to a live connection", () => {
        const source = renderImageNode({ isConnecting: true, isConnectionSource: true, connectingHandleType: "source" });
        const target = renderImageNode({ isConnecting: true, isConnectionTarget: true, connectingHandleType: "source" });
        const pulledAway = renderImageNode({ isConnecting: true, isConnectionSource: true, connectionSourceFeedbackVisible: false, connectingHandleType: "source" });

        expect(source).toMatch(/data-canvas-connection-handle="left"[^>]+pointer-events-none opacity-0/);
        expect(source).toMatch(/data-canvas-connection-handle="right"[^>]+pointer-events-auto opacity-100/);
        expect(target).toMatch(/data-canvas-connection-handle="left"[^>]+pointer-events-auto opacity-100/);
        expect(target).toMatch(/data-canvas-connection-handle="right"[^>]+pointer-events-none opacity-0/);
        expect(pulledAway).toMatch(/data-canvas-connection-handle="left"[^>]+pointer-events-none opacity-0/);
        expect(pulledAway).toMatch(/data-canvas-connection-handle="right"[^>]+pointer-events-none opacity-0/);
    });
});

describe("CanvasNode media replacement", () => {
    beforeEach(() => useThemeStore.setState({ theme: "light" }));

    it("shows a restrained replacement action only for selected media with content", () => {
        const replace = vi.fn();
        const image = renderImageNode({ isSelected: true, onReplaceMedia: replace });
        const empty = renderImageNode({ data: { ...imageNode, metadata: {} }, isSelected: true, onReplaceMedia: replace });
        const text = renderImageNode({ data: { ...imageNode, type: CanvasNodeType.Text, metadata: { content: "text" } }, isSelected: true, onReplaceMedia: replace });

        expect(image).toContain('aria-label="替换图片"');
        expect(image).toContain("motion-reduce:transition-none");
        expect(empty).not.toContain('aria-label="替换图片"');
        expect(text).not.toContain('aria-label="替换');
    });
});

describe("CanvasNode task content", () => {
    it("keeps long task text scrollable while preserving the footer", () => {
        const taskNode: CanvasNodeData = {
            ...imageNode,
            id: "task",
            type: CanvasNodeType.Task,
            title: "Agent 任务",
            height: 210,
            metadata: { agentTaskStatus: "completed", prompt: "很长的任务说明".repeat(30), agentTaskAttempts: 1 },
        };

        const markup = renderImageNode({ data: taskNode });

        expect(markup).toContain("thin-scrollbar min-h-0 flex-1 overflow-y-auto");
        expect(markup).toContain("mt-3 flex shrink-0");
    });
});

describe("CanvasNode generation progress", () => {
    it("renders the real percentage or an indeterminate progress bar while a node is loading", () => {
        const loadingNode: CanvasNodeData = {
            ...imageNode,
            id: "loading-image",
            metadata: { status: "loading", taskStage: "submitting", taskProgress: 47 },
        };

        expect(renderImageNode({ data: loadingNode })).toContain("47%");
        expect(renderImageNode({ data: { ...loadingNode, metadata: { status: "loading" } } })).toContain("canvas-task-progress-indeterminate");
    });
});

describe("CanvasNode drawing editor entry points", () => {
    const drawingNode: CanvasNodeData = {
        ...imageNode,
        id: "drawing",
        type: CanvasNodeType.Drawing,
        title: "绘图",
        metadata: {},
    };

    it("shows both the center and footer edit buttons for an empty drawing", () => {
        const markup = renderImageNode({ data: drawingNode, onEditDrawing: noop });

        expect(markup.match(/aria-label="编辑绘图"/g)).toHaveLength(2);
    });

    it("keeps only the footer edit button after a preview exists", () => {
        const markup = renderImageNode({
            data: {
                ...drawingNode,
                metadata: {
                    drawingPreview: {
                        serverUrl: "/api/reference-assets/permanent/drawing.png",
                        mimeType: "image/png",
                        width: 320,
                        height: 320,
                    },
                },
            },
            onEditDrawing: noop,
        });

        expect(markup.match(/aria-label="编辑绘图"/g)).toHaveLength(1);
    });
});

describe("CanvasNode error content", () => {
    it("centers the error and retry action inside the node", () => {
        const failedNode: CanvasNodeData = { ...imageNode, metadata: { status: "error", errorDetails: "生成失败，请稍后重试" } };

        const markup = renderImageNode({ data: failedNode, onRetry: noop });

        expect(markup).toContain("h-full w-full flex-col items-center justify-center");
        expect(markup).toContain(`color:${canvasThemes.light.node.danger}`);
        expect(markup).toContain("生成失败，请稍后重试");
        expect(markup).toContain("重试");
    });

    it("renders a cancelled terminal state without a retry action", () => {
        const cancelledNode: CanvasNodeData = { ...imageNode, metadata: { status: "cancelled", agentTaskStatus: "cancelled" } };

        const markup = renderImageNode({ data: cancelledNode, onRetry: noop });

        expect(markup).toContain("任务已取消");
        expect(markup).not.toContain("重试");
    });
});
