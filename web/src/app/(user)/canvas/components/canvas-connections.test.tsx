import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../types";
import { ConnectionPath } from "./canvas-connections";

const from: CanvasNodeData = { id: "from", type: CanvasNodeType.Image, title: "Source", position: { x: 0, y: 0 }, width: 340, height: 240 };
const to: CanvasNodeData = { id: "to", type: CanvasNodeType.Image, title: "Target", position: { x: 620, y: 80 }, width: 340, height: 240 };
const connection: CanvasConnection = { id: "edge", fromNodeId: from.id, toNodeId: to.id, fromAnchorRatio: 0.25, toAnchorRatio: 0.75 };

function renderConnection(active = true) {
    return renderToStaticMarkup(
        <svg>
            <ConnectionPath connection={connection} from={from} to={to} active={active} onSelect={() => undefined} />
        </svg>,
    );
}

describe("Canvas connection path", () => {
    beforeEach(() => useThemeStore.setState({ theme: "light" }));

    it("keeps the line selectable without adding a second plus control", () => {
        const markup = renderConnection();

        expect(markup).toContain('data-connection-id="edge"');
        expect(markup).not.toContain("data-canvas-connection-insert");
    });

    it("keeps a selected connection as a darker line without a focus frame or flow layer", () => {
        expect(renderConnection()).not.toContain('class="canvas-connection-flow"');
        expect(renderConnection()).not.toContain('tabindex="0"');
        expect(renderConnection()).not.toContain('role="button"');
        expect(renderConnection(false)).not.toContain("canvas-connection-flow");
    });
});
