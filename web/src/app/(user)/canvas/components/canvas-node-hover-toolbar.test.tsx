import { App } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "../types";
import { CanvasNodeHoverToolbar, resolveCanvasNodeToolbarTop } from "./canvas-node-hover-toolbar";

const node: CanvasNodeData = {
    id: "source-node",
    type: CanvasNodeType.Image,
    title: "Source",
    position: { x: 0, y: 0 },
    width: 320,
    height: 240,
    metadata: { content: "/api/reference-assets/source.png", storageKey: "source.png" },
};

function renderToolbar(active: boolean, stopping = false) {
    const noop = vi.fn();
    return renderToStaticMarkup(
        <App>
            <CanvasNodeHoverToolbar
                node={node}
                viewport={{ x: 0, y: 0, k: 1 }}
                onKeep={noop}
                onLeave={noop}
                onInfo={noop}
                onEditText={noop}
                onDecreaseFont={noop}
                onIncreaseFont={noop}
                onToggleDialog={noop}
                onGenerateImage={noop}
                onUpload={noop}
                onDownload={noop}
                onSaveAsset={noop}
                onAnnotate={noop}
                onMaskEdit={noop}
                onEmotion={noop}
                onPortraitTexture={noop}
                onRemoveBackground={noop}
                onCancelBackgroundRemoval={noop}
                onRefineBackground={noop}
                onCrop={noop}
                onSplit={noop}
                onUpscale={noop}
                onSuperResolve={noop}
                onAngle={noop}
                onViewImage={noop}
                onReversePrompt={noop}
                onRetry={noop}
                onToggleFreeResize={noop}
                onToggleLocked={noop}
                backgroundRemovalNodeIds={active ? new Set([node.id]) : new Set()}
                backgroundRemovalStoppingNodeIds={stopping ? new Set([node.id]) : new Set()}
                onDelete={noop}
            />
        </App>,
    );
}

describe("canvas background-removal toolbar action", () => {
    it("replaces the cutout action with a directly enabled stop icon while active", () => {
        const markup = renderToolbar(true);

        expect(markup).toContain('aria-label="终止抠图"');
        expect(markup).toContain("lucide-square");
        expect(markup).not.toMatch(/aria-label="终止抠图"[^>]*disabled/);
    });

    it("shows a disabled terminating state only after the stop action is clicked", () => {
        const markup = renderToolbar(true, true);

        expect(markup).toMatch(/aria-label="正在终止抠图"[^>]*disabled/);
        expect(markup).toContain("lucide-loader-circle");
    });
});

describe("canvas node toolbar viewport placement", () => {
    it("keeps the toolbar above a node when there is enough room", () => {
        expect(resolveCanvasNodeToolbarTop({ nodeTop: 300, nodeBottom: 620, viewportHeight: 900 })).toBe(242);
    });

    it("moves the toolbar below a node near the top navigation", () => {
        expect(resolveCanvasNodeToolbarTop({ nodeTop: 40, nodeBottom: 280, viewportHeight: 900 })).toBe(294);
    });

    it("clamps a toolbar for a node spanning the available viewport", () => {
        expect(resolveCanvasNodeToolbarTop({ nodeTop: 40, nodeBottom: 880, viewportHeight: 900 })).toBe(72);
    });
});
