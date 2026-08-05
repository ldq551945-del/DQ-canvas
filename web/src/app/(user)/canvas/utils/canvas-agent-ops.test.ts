import { describe, expect, it } from "vitest";
import { applyCanvasAgentOps, type CanvasAgentSnapshot } from "./canvas-agent-ops";
import { CanvasNodeType } from "../types";

const snapshot: CanvasAgentSnapshot = { projectId: "p", title: "画布", nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };

describe("Agent 产物排版", () => {
    it("keeps the current selection while stable loading nodes are planned and replayed", () => {
        const selected: CanvasAgentSnapshot = {
            ...snapshot,
            nodes: [{ id: "reference", type: CanvasNodeType.Image, title: "参考图", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { status: "success" } }],
            selectedNodeIds: ["reference"],
        };
        const ops = [
            { type: "add_node" as const, id: "output-run-0-0", nodeType: CanvasNodeType.Image, position: { x: 400, y: 0 }, metadata: { agentRunId: "run", agentTaskId: "task", status: "loading" as const, size: "16:9" } },
            { type: "update_node" as const, id: "output-run-0-0", metadata: { status: "success" as const, naturalWidth: 1600, naturalHeight: 900 } },
        ];

        const first = applyCanvasAgentOps(selected, ops);
        const replay = applyCanvasAgentOps(first, ops);

        expect(first.selectedNodeIds).toEqual(["reference"]);
        expect(replay.nodes.filter((node) => node.id === "output-run-0-0")).toHaveLength(1);
        expect(replay.nodes.find((node) => node.id === "output-run-0-0")).toMatchObject({ width: 340, height: 191.25, metadata: { status: "success", naturalWidth: 1600, naturalHeight: 900 } });
    });

    it("places every Agent Run node in a free position and replays stable ids idempotently", () => {
        const occupied: CanvasAgentSnapshot = {
            ...snapshot,
            nodes: [{ id: "existing", type: CanvasNodeType.Image, title: "已有节点", position: { x: 900, y: 0 }, width: 340, height: 340 }],
        };
        const first = applyCanvasAgentOps(occupied, [
            { type: "add_node", id: "brief-run", nodeType: CanvasNodeType.Brief, position: { x: 900, y: 0 }, metadata: { agentRunId: "run" } },
            { type: "add_node", id: "task-run-0", nodeType: CanvasNodeType.Task, position: { x: 900, y: 0 }, metadata: { agentRunId: "run" } },
        ]);
        expect(first.nodes).toHaveLength(3);
        expect(first.nodes[1].position).not.toEqual(occupied.nodes[0].position);
        expect(first.nodes[2].position).not.toEqual(occupied.nodes[0].position);
        expect(first.nodes[1].position).not.toEqual(first.nodes[2].position);

        const replay = applyCanvasAgentOps(first, [{ type: "add_node", id: "brief-run", nodeType: CanvasNodeType.Brief, title: "已更新", metadata: { agentRunId: "run" } }]);
        expect(replay.nodes).toHaveLength(3);
        expect(replay.nodes[1].title).toBe("已更新");
    });

    it("keeps manually added nodes at their requested position", () => {
        const occupied: CanvasAgentSnapshot = {
            ...snapshot,
            nodes: [{ id: "existing", type: CanvasNodeType.Image, title: "已有节点", position: { x: 20, y: 30 }, width: 340, height: 340 }],
        };
        const created = applyCanvasAgentOps(occupied, [{ type: "add_node", id: "manual", nodeType: CanvasNodeType.Text, position: { x: 20, y: 30 } }]);

        expect(created.nodes[1].position).toEqual({ x: 20, y: 30 });
    });

    it("sizes image outputs from their natural dimensions", () => {
        const created = applyCanvasAgentOps(snapshot, [{ type: "add_node", id: "output-agent-run-0-0", nodeType: CanvasNodeType.Image, position: { x: 400, y: 20 }, metadata: { content: "/image.png", naturalWidth: 1024, naturalHeight: 1024 } }]);

        expect(created.nodes[0]).toMatchObject({ width: 340, height: 340, metadata: { naturalWidth: 1024, naturalHeight: 1024 } });
    });

    it("keeps locked output geometry when an async Agent result adds natural dimensions", () => {
        const locked: CanvasAgentSnapshot = {
            ...snapshot,
            nodes: [
                {
                    id: "output-agent-run-0-0",
                    type: CanvasNodeType.Image,
                    title: "Locked output",
                    position: { x: 120, y: 80 },
                    width: 420,
                    height: 260,
                    metadata: { locked: true, status: "loading" },
                },
            ],
        };

        const updated = applyCanvasAgentOps(locked, [
            {
                type: "update_node",
                id: "output-agent-run-0-0",
                patch: { position: { x: 900, y: 700 }, width: 800, height: 450 },
                metadata: { status: "success", content: "/result.png", naturalWidth: 1600, naturalHeight: 900 },
            },
        ]);

        expect(updated.nodes[0]).toMatchObject({
            position: { x: 120, y: 80 },
            width: 420,
            height: 260,
            metadata: { locked: true, status: "success", content: "/result.png", naturalWidth: 1600, naturalHeight: 900 },
        });
    });

    it("applies explicit geometry patches after the output is unlocked", () => {
        const unlocked: CanvasAgentSnapshot = {
            ...snapshot,
            nodes: [
                {
                    id: "output-agent-run-0-0",
                    type: CanvasNodeType.Image,
                    title: "Unlocked output",
                    position: { x: 120, y: 80 },
                    width: 420,
                    height: 260,
                    metadata: { locked: false, freeResize: true, status: "loading" },
                },
            ],
        };

        const updated = applyCanvasAgentOps(unlocked, [{ type: "update_node", id: "output-agent-run-0-0", patch: { position: { x: 900, y: 700 }, width: 800, height: 450 } }]);

        expect(updated.nodes[0]).toMatchObject({ position: { x: 900, y: 700 }, width: 800, height: 450 });
    });

    it("uses the requested image ratio before natural dimensions are available", () => {
        const created = applyCanvasAgentOps(snapshot, [{ type: "add_node", id: "output-agent-run-0-0", nodeType: CanvasNodeType.Image, position: { x: 400, y: 20 }, metadata: { content: "/image.png", size: "1:1" } }]);

        expect(created.nodes[0]).toMatchObject({ width: 340, height: 340 });
    });

    it("assigns a stable drawing document id when the Agent creates a drawing node", () => {
        const created = applyCanvasAgentOps(snapshot, [{ type: "add_node", id: "drawing-agent", nodeType: CanvasNodeType.Drawing, position: { x: 40, y: 20 } }]);
        const replay = applyCanvasAgentOps(created, [{ type: "add_node", id: "drawing-agent", nodeType: CanvasNodeType.Drawing, title: "线稿" }]);

        expect(created.nodes[0].metadata?.drawingId).toBe("drawing-agent-document");
        expect(replay.nodes[0].metadata?.drawingId).toBe("drawing-agent-document");
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

    it("keeps distinct port pairs and redraws the matching edge anchors", () => {
        const nodes = applyCanvasAgentOps(snapshot, [
            { type: "add_node", id: "one", nodeType: CanvasNodeType.Text, position: { x: 10, y: 20 } },
            { type: "add_node", id: "two", nodeType: CanvasNodeType.Image, position: { x: 400, y: 20 } },
        ]);
        const connected = applyCanvasAgentOps(nodes, [
            { type: "connect_nodes", id: "edge-a", fromNodeId: "one", toNodeId: "two", fromHandleId: "output:a", toHandleId: "input", fromAnchorRatio: 0.2, toAnchorRatio: 0.7 },
            { type: "connect_nodes", id: "edge-b", fromNodeId: "one", toNodeId: "two", fromHandleId: "output:b", toHandleId: "input", fromAnchorRatio: 0.4, toAnchorRatio: 0.6 },
            { type: "connect_nodes", id: "ignored", fromNodeId: "one", toNodeId: "two", fromHandleId: "output:a", toHandleId: "input", fromAnchorRatio: 0.3, toAnchorRatio: 0.8 },
        ]);

        expect(connected.connections).toEqual([
            { id: "edge-a", fromNodeId: "one", toNodeId: "two", fromHandleId: "output:a", toHandleId: "input", fromAnchorRatio: 0.3, toAnchorRatio: 0.8 },
            { id: "edge-b", fromNodeId: "one", toNodeId: "two", fromHandleId: "output:b", toHandleId: "input", fromAnchorRatio: 0.4, toAnchorRatio: 0.6 },
        ]);
    });
});
