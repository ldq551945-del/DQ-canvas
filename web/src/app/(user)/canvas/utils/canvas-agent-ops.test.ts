import { describe, expect, it } from "vitest";
import { applyCanvasAgentOps, type CanvasAgentSnapshot } from "./canvas-agent-ops";
import { CanvasNodeType } from "../types";

const snapshot: CanvasAgentSnapshot = { projectId: "p", title: "画布", nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };

describe("Agent 产物排版", () => {
    it("avoids overlapping output nodes and replays stable ids idempotently", () => {
        const first = applyCanvasAgentOps(snapshot, [
            { type: "add_node", id: "output-agent-run-0-0", nodeType: CanvasNodeType.Image, position: { x: 900, y: 0 } },
            { type: "add_node", id: "output-agent-run-0-1", nodeType: CanvasNodeType.Image, position: { x: 900, y: 0 } },
        ]);
        expect(first.nodes).toHaveLength(2);
        expect(first.nodes[0].position).not.toEqual(first.nodes[1].position);
        const replay = applyCanvasAgentOps(first, [{ type: "add_node", id: "output-agent-run-0-0", nodeType: CanvasNodeType.Image, title: "已更新" }]);
        expect(replay.nodes).toHaveLength(2);
        expect(replay.nodes[0].title).toBe("已更新");
    });

    it("applies node, connection, selection, movement, resize, viewport, and delete ops", () => {
        const created = applyCanvasAgentOps(snapshot, [
            { type: "add_node", id: "one", nodeType: CanvasNodeType.Text, position: { x: 10, y: 20 } },
            { type: "add_node", id: "two", nodeType: CanvasNodeType.Image, position: { x: 400, y: 20 } },
            { type: "connect_nodes", id: "edge", fromNodeId: "one", toNodeId: "two" },
            { type: "connect_nodes", id: "duplicate", fromNodeId: "one", toNodeId: "two" },
            { type: "update_node", id: "one", patch: { position: { x: 80, y: 90 }, width: 520, height: 260 }, metadata: { content: "已更新" } },
            { type: "select_nodes", ids: ["one", "missing"] },
            { type: "set_viewport", viewport: { x: 120, y: 60, k: 1.5 } },
        ]);

        expect(created.nodes.find((node) => node.id === "one")).toMatchObject({ position: { x: 80, y: 90 }, width: 520, height: 260, metadata: { content: "已更新" } });
        expect(created.connections).toEqual([{ id: "edge", fromNodeId: "one", toNodeId: "two" }]);
        expect(created.selectedNodeIds).toEqual(["one"]);
        expect(created.viewport).toEqual({ x: 120, y: 60, k: 1.5 });

        const deleted = applyCanvasAgentOps(created, [{ type: "delete_node", id: "one" }]);
        expect(deleted.nodes.map((node) => node.id)).toEqual(["two"]);
        expect(deleted.connections).toEqual([]);
        expect(deleted.selectedNodeIds).toEqual([]);
    });
});
