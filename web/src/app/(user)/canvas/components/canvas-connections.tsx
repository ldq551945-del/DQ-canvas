import { useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasConnection, CanvasNodeData, ConnectionHandle, Position } from "../types";
import { buildNodeConnectionPath, buildPreviewConnectionPath, clampAnchorRatio, nodeAnchorRatioAtY, nodeAnchorY } from "../utils/canvas-connection-path";

export function ConnectionPath({
    connection,
    from,
    to,
    active,
    onSelect,
    onContextMenu,
}: {
    connection: CanvasConnection;
    from: CanvasNodeData;
    to: CanvasNodeData;
    active: boolean;
    onSelect: () => void;
    onContextMenu?: (event: ReactMouseEvent<SVGPathElement>) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [hovered, setHovered] = useState(false);
    const pathD = buildNodeConnectionPath(from, to, connection.fromAnchorRatio, connection.toAnchorRatio);
    const emphasized = active || hovered;
    const showFlow = hovered && !active;
    const gradientId = `canvas-flow-${connection.id.replace(/[^a-zA-Z0-9_-]/g, "") || "connection"}`;

    return (
        <g>
            {showFlow ? (
                <defs>
                    <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={from.position.x + from.width} y1={nodeAnchorY(from, connection.fromAnchorRatio)} x2={to.position.x} y2={nodeAnchorY(to, connection.toAnchorRatio)}>
                        <stop offset="0%" stopColor={theme.node.muted} stopOpacity={0.18} />
                        <stop offset="48%" stopColor={theme.node.activeStroke} stopOpacity={0.58} />
                        <stop offset="100%" stopColor={theme.node.activeStroke} stopOpacity={0.34} />
                    </linearGradient>
                </defs>
            ) : null}
            <path
                data-connection-id={connection.id}
                d={pathD}
                stroke="transparent"
                strokeWidth="16"
                vectorEffect="non-scaling-stroke"
                fill="none"
                style={{ cursor: "pointer", pointerEvents: "stroke" }}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                aria-label="选择连线"
                onClick={(event) => {
                    event.stopPropagation();
                    onSelect();
                }}
                onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onContextMenu?.(event);
                }}
            />
            <path
                d={pathD}
                stroke={emphasized ? theme.node.activeStroke : theme.node.muted}
                strokeWidth={hovered ? 1.6 : 1}
                strokeOpacity={active ? 0.72 : hovered ? 0.52 : 0.24}
                fill="none"
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
                style={{ pointerEvents: "none" }}
            />
            {showFlow ? (
                <path
                    className="canvas-connection-flow"
                    d={pathD}
                    stroke={`url(#${gradientId})`}
                    strokeWidth="1.8"
                    vectorEffect="non-scaling-stroke"
                    strokeOpacity="1"
                    strokeDasharray="18 26"
                    fill="none"
                    strokeLinecap="round"
                    style={{ filter: `drop-shadow(0 0 3px ${theme.node.activeStroke}35)`, pointerEvents: "none" }}
                />
            ) : null}
        </g>
    );
}

export function ActiveConnectionPath({ node, handle, mouseWorld, target }: { node?: CanvasNodeData; handle: ConnectionHandle; mouseWorld: Position; target?: CanvasNodeData }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (!node) return null;

    const sourceRatio = clampAnchorRatio(handle.anchorRatio);
    const targetRatio = target ? nodeAnchorRatioAtY(target, mouseWorld.y) : 0.5;
    const startX = handle.handleType === "source" ? node.position.x + node.width : mouseWorld.x;
    const startY = handle.handleType === "source" ? nodeAnchorY(node, sourceRatio) : mouseWorld.y;
    const endX = handle.handleType === "source" ? mouseWorld.x : node.position.x;
    const endY = handle.handleType === "source" ? mouseWorld.y : nodeAnchorY(node, sourceRatio);
    const snappedStartX = handle.handleType === "target" && target ? target.position.x + target.width : startX;
    const snappedStartY = handle.handleType === "target" && target ? nodeAnchorY(target, targetRatio) : startY;
    const snappedEndX = handle.handleType === "source" && target ? target.position.x : endX;
    const snappedEndY = handle.handleType === "source" && target ? nodeAnchorY(target, targetRatio) : endY;
    const pathD = buildPreviewConnectionPath({ x: snappedStartX, y: snappedStartY }, { x: snappedEndX, y: snappedEndY });

    return <path d={pathD} stroke={theme.node.activeStroke} strokeWidth="1.4" strokeOpacity="0.72" vectorEffect="non-scaling-stroke" fill="none" strokeDasharray="8 8" strokeLinecap="round" />;
}
