import type { CanvasNodeData, Position } from "../types";

const HANDLE_CLEARANCE = 32;
const FORWARD_GAP = HANDLE_CLEARANCE * 2;
const CORNER_RADIUS = 14;

export function buildNodeConnectionPath(from: CanvasNodeData, to: CanvasNodeData) {
    const start = { x: from.position.x + from.width, y: from.position.y + from.height / 2 };
    const end = { x: to.position.x, y: to.position.y + to.height / 2 };
    const forwardDistance = end.x - start.x;

    if (forwardDistance >= FORWARD_GAP) {
        const curvature = Math.min(Math.max(forwardDistance * 0.5, 50), 240);
        return `M ${start.x} ${start.y} C ${start.x + curvature} ${start.y}, ${end.x - curvature} ${end.y}, ${end.x} ${end.y}`;
    }

    const fromBottom = from.position.y + from.height;
    const toBottom = to.position.y + to.height;
    if (fromBottom <= to.position.y)
        return roundedPolyline([
            start,
            { x: start.x + HANDLE_CLEARANCE, y: start.y },
            { x: start.x + HANDLE_CLEARANCE, y: (fromBottom + to.position.y) / 2 },
            { x: end.x - HANDLE_CLEARANCE, y: (fromBottom + to.position.y) / 2 },
            { x: end.x - HANDLE_CLEARANCE, y: end.y },
            end,
        ]);
    if (toBottom <= from.position.y)
        return roundedPolyline([
            start,
            { x: start.x + HANDLE_CLEARANCE, y: start.y },
            { x: start.x + HANDLE_CLEARANCE, y: (toBottom + from.position.y) / 2 },
            { x: end.x - HANDLE_CLEARANCE, y: (toBottom + from.position.y) / 2 },
            { x: end.x - HANDLE_CLEARANCE, y: end.y },
            end,
        ]);

    const routeAbove = Math.min(from.position.y, to.position.y) - HANDLE_CLEARANCE;
    const routeBelow = Math.max(fromBottom, toBottom) + HANDLE_CLEARANCE;
    const aboveDistance = Math.abs(start.y - routeAbove) + Math.abs(end.y - routeAbove);
    const belowDistance = Math.abs(start.y - routeBelow) + Math.abs(end.y - routeBelow);
    const routeY = aboveDistance <= belowDistance ? routeAbove : routeBelow;
    const outerRight = Math.max(start.x, to.position.x + to.width) + HANDLE_CLEARANCE;
    const outerLeft = Math.min(end.x, from.position.x) - HANDLE_CLEARANCE;
    return roundedPolyline([start, { x: outerRight, y: start.y }, { x: outerRight, y: routeY }, { x: outerLeft, y: routeY }, { x: outerLeft, y: end.y }, end]);
}

export function buildPreviewConnectionPath(start: Position, end: Position) {
    const forwardDistance = end.x - start.x;
    if (forwardDistance >= FORWARD_GAP) {
        const curvature = Math.min(Math.max(forwardDistance * 0.5, 50), 240);
        return `M ${start.x} ${start.y} C ${start.x + curvature} ${start.y}, ${end.x - curvature} ${end.y}, ${end.x} ${end.y}`;
    }

    const routeY = (start.y + end.y) / 2;
    return roundedPolyline([start, { x: start.x + HANDLE_CLEARANCE, y: start.y }, { x: start.x + HANDLE_CLEARANCE, y: routeY }, { x: end.x - HANDLE_CLEARANCE, y: routeY }, { x: end.x - HANDLE_CLEARANCE, y: end.y }, end]);
}

function roundedPolyline(points: Position[]) {
    const compact = points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
    if (compact.length < 2) return "";

    let path = `M ${format(compact[0].x)} ${format(compact[0].y)}`;
    for (let index = 1; index < compact.length - 1; index += 1) {
        const previous = compact[index - 1];
        const current = compact[index];
        const next = compact[index + 1];
        const incomingLength = Math.hypot(current.x - previous.x, current.y - previous.y);
        const outgoingLength = Math.hypot(next.x - current.x, next.y - current.y);
        const radius = Math.min(CORNER_RADIUS, incomingLength / 2, outgoingLength / 2);
        const before = moveToward(current, previous, radius);
        const after = moveToward(current, next, radius);
        path += ` L ${format(before.x)} ${format(before.y)} Q ${format(current.x)} ${format(current.y)} ${format(after.x)} ${format(after.y)}`;
    }
    const end = compact[compact.length - 1];
    return `${path} L ${format(end.x)} ${format(end.y)}`;
}

function moveToward(from: Position, to: Position, distance: number) {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (!length) return from;
    return { x: from.x + ((to.x - from.x) / length) * distance, y: from.y + ((to.y - from.y) / length) * distance };
}

function format(value: number) {
    return Number(value.toFixed(2));
}
