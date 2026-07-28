import type { AuthSettings } from "@/lib/auth/store";
import { closestImageAspectRatio, normalizeImageSizeValue, parseImageDimensions } from "@/lib/image-size";
import type { AgentRun, AgentRunReference, AgentRunTask } from "@/lib/server/agent-run-store";
import type { AgentPlan } from "@/lib/server/agent-run-validation";

import { selectedCanvasNodeIds } from "./agent-run-surface-policy";

export type CanvasTaskReferenceNode = {
    title: string;
    summary: string;
    url?: string;
    type?: AgentRunTask["type"];
    content?: string;
    width?: number;
    height?: number;
    size?: string;
};

export function canvasSnapshotNodes(snapshot: unknown) {
    const map = new Map<string, CanvasTaskReferenceNode>();
    const nodes = snapshot && typeof snapshot === "object" && Array.isArray((snapshot as { nodes?: unknown }).nodes) ? (snapshot as { nodes: Array<Record<string, unknown>> }).nodes : [];
    for (const node of nodes) {
        if (typeof node.id !== "string") continue;
        const metadata = node.metadata && typeof node.metadata === "object" ? (node.metadata as Record<string, unknown>) : {};
        const content = [metadata.content, metadata.prompt].find((item) => typeof item === "string" && item);
        const url = [metadata.remoteUrl, metadata.serverUrl, metadata.url, metadata.dataUrl].find((item) => typeof item === "string" && item) as string | undefined;
        const type = node.type === "panorama" ? "image" : node.type === "text" || node.type === "image" || node.type === "video" || node.type === "audio" ? node.type : undefined;
        map.set(node.id, {
            title: String(node.title || node.type || "节点").slice(0, 200),
            summary: `${String(node.title || node.type || "节点").slice(0, 200)}${content ? `；内容：${String(content).slice(0, 2000)}` : ""}${url && !url.startsWith("data:") ? `；素材：${url.slice(0, 2000)}` : ""}`,
            url,
            type,
            content: typeof content === "string" ? content : undefined,
            width: positiveNumber(metadata.naturalWidth) || positiveNumber(node.width),
            height: positiveNumber(metadata.naturalHeight) || positiveNumber(node.height),
            size: typeof metadata.size === "string" ? metadata.size : undefined,
        });
    }
    return map;
}

export function resolveCanvasTaskTargetNodeId(plannedTargetNodeId: string | undefined, taskType: AgentRunTask["type"], selectedNodeIds: Set<string>, nodes: Map<string, CanvasTaskReferenceNode>) {
    const planned = plannedTargetNodeId?.trim();
    if (selectedNodeIds.size) {
        if (planned && selectedNodeIds.has(planned) && nodeSupportsTaskReference(nodes.get(planned)?.type, taskType)) return planned;
        return Array.from(selectedNodeIds).find((id) => nodeSupportsTaskReference(nodes.get(id)?.type, taskType));
    }
    return planned && nodeSupportsTaskReference(nodes.get(planned)?.type, taskType) ? planned : undefined;
}

export function resolveAgentTaskRatio(input: {
    type: AgentRunTask["type"];
    requestedImageSize?: string;
    configuredImageSize?: string;
    plannedRatio?: string;
    defaultSize?: string;
    globalSize?: string;
    reference?: Pick<CanvasTaskReferenceNode, "type" | "width" | "height" | "size">;
}) {
    if (input.type !== "image" && input.type !== "video") return input.plannedRatio?.trim() || input.defaultSize?.trim() || input.globalSize?.trim() || undefined;
    const explicit = normalizeImageSizeValue(input.requestedImageSize);
    const configured = normalizeImageSizeValue(input.configuredImageSize);
    const reference = input.reference?.type === "image" ? normalizeImageSizeValue(input.reference.size) || closestImageAspectRatio(input.reference.width, input.reference.height) : "";
    return explicit || configured || reference || normalizeImageSizeValue(input.plannedRatio) || normalizeImageSizeValue(input.defaultSize) || normalizeImageSizeValue(input.globalSize) || "auto";
}

export function agentSurfaceImageSize(surface: AgentRun["surface"], snapshot: unknown) {
    if (!snapshot || typeof snapshot !== "object") return undefined;
    if (surface === "canvas") {
        const canvasSnapshot = snapshot as { imageSize?: unknown; nodes?: unknown; connections?: unknown };
        const imageSize = exactImageSize(canvasSnapshot.imageSize);
        if (imageSize) return imageSize;

        const nodes = Array.isArray(canvasSnapshot.nodes) ? canvasSnapshot.nodes.filter((node): node is Record<string, unknown> => Boolean(node) && typeof node === "object") : [];
        const configuredNodes = nodes.flatMap((node) => {
            if (node.type !== "config" || typeof node.id !== "string") return [];
            const metadata = node.metadata && typeof node.metadata === "object" ? (node.metadata as Record<string, unknown>) : {};
            const size = exactImageSize(metadata.size);
            return size ? [{ id: node.id, size }] : [];
        });
        if (!configuredNodes.length) return undefined;

        const selected = new Set(selectedCanvasNodeIds(snapshot));
        const selectedConfig = configuredNodes.find((node) => selected.has(node.id));
        if (selectedConfig) return selectedConfig.size;

        const connections = Array.isArray(canvasSnapshot.connections) ? canvasSnapshot.connections.filter((connection): connection is Record<string, unknown> => Boolean(connection) && typeof connection === "object") : [];
        const connectedConfig = configuredNodes.find((node) =>
            connections.some((connection) => (connection.fromNodeId === node.id && selected.has(String(connection.toNodeId || ""))) || (connection.toNodeId === node.id && selected.has(String(connection.fromNodeId || "")))),
        );
        if (connectedConfig) return connectedConfig.size;

        const uniqueSizes = Array.from(new Set(configuredNodes.map((node) => node.size)));
        return uniqueSizes.length === 1 ? uniqueSizes[0] : undefined;
    }
    if (surface !== "drama") return undefined;
    const project = (snapshot as { project?: unknown }).project;
    if (!project || typeof project !== "object") return undefined;
    return normalizeImageSizeValue((project as { ratio?: unknown }).ratio) || undefined;
}

export function normalizeCanvasPlanForSelection(plan: AgentPlan, snapshot: unknown, requestPrompt: string): AgentPlan {
    const nodes = canvasSnapshotNodes(snapshot);
    const selectedTextEntry = selectedCanvasNodeIds(snapshot)
        .map((id) => [id, nodes.get(id)] as const)
        .find((entry): entry is readonly [string, CanvasTaskReferenceNode] => entry[1]?.type === "text");
    if (!selectedTextEntry || !requestsSelectedTextEdit(requestPrompt)) return plan;
    const [targetNodeId, target] = selectedTextEntry;
    const plannedText = plan.deliverables.find((item) => item.type === "text");
    const original = target.content?.trim() || "";
    const prompt = ["请按用户要求改写当前提示词，只返回修改后的完整提示词，不要解释、标题或 Markdown。", `用户要求：${requestPrompt}`, original ? `当前提示词：${original}` : ""].filter(Boolean).join("\n\n");
    return {
        ...plan,
        intent: "generation",
        objective: requestPrompt,
        reply: "我会直接修改当前提示词节点，不会自动生成图片。",
        decisions: [],
        projectHandoff: undefined,
        deliverables: [
            {
                id: plannedText?.id?.trim() || "edit-selected-text",
                targetNodeId,
                title: `修改${target.title || "提示词"}`,
                type: "text",
                model: plannedText?.model,
                prompt,
                count: 1,
                dependencies: [],
                assetIds: [],
            },
        ],
    };
}

export function prepareFailedAgentTaskRetry(run: AgentRun, task: AgentRunTask, settings: AuthSettings) {
    if (run.surface !== "canvas")
        return {
            ...task,
            ratio: resolveAgentTaskRatio({ type: task.type, requestedImageSize: run.requestedImageSize, configuredImageSize: agentSurfaceImageSize(run.surface, run.snapshot), plannedRatio: task.ratio, globalSize: settings.generationDefaults.imageSize }),
        };
    const nodes = canvasSnapshotNodes(run.snapshot);
    const selected = new Set(selectedCanvasNodeIds(run.snapshot).filter((id) => nodes.has(id)));
    const targetNodeId = resolveCanvasTaskTargetNodeId(task.targetNodeId, task.type, selected, nodes);
    const target = targetNodeId ? nodes.get(targetNodeId) : undefined;
    const references = target?.url && isMediaReferenceType(target.type) ? ([{ url: target.url, type: target.type }] satisfies AgentRunReference[]) : task.references;
    const primaryReference = references?.[0];
    const context = target ? `基于画布已有节点进行局部修改：${target.summary}` : "";
    return {
        ...task,
        targetNodeId: target ? targetNodeId : task.targetNodeId,
        referenceUrl: primaryReference?.url || task.referenceUrl,
        referenceType: primaryReference?.type || task.referenceType,
        references,
        ratio: resolveAgentTaskRatio({
            type: task.type,
            requestedImageSize: run.requestedImageSize,
            configuredImageSize: agentSurfaceImageSize(run.surface, run.snapshot),
            plannedRatio: task.ratio,
            globalSize: settings.generationDefaults.imageSize,
            reference: target,
        }),
        prompt: context && !task.prompt.includes(context) ? `${task.prompt}\n\n${context}` : task.prompt,
    };
}

export function failedAgentTaskRetryOps(run: AgentRun, task: AgentRunTask) {
    if (run.surface !== "canvas") return [];
    const taskIndex = run.tasks.findIndex((item) => item.id === task.id);
    if (taskIndex < 0) return [];
    const taskNodeId = `task-${run.id}-${taskIndex}`;
    return [
        { type: "update_node", id: taskNodeId, metadata: { targetNodeId: task.targetNodeId, agentTaskStatus: "ready", agentTaskError: undefined, agentTaskAttempts: task.attempts } },
        ...(task.targetNodeId ? [{ type: "connect_nodes", fromNodeId: task.targetNodeId, toNodeId: taskNodeId }] : []),
    ];
}

function nodeSupportsTaskReference(nodeType: CanvasTaskReferenceNode["type"], taskType: AgentRunTask["type"]) {
    if (taskType === "text") return nodeType === "text";
    if (taskType === "image") return nodeType === "image";
    if (taskType === "video") return nodeType === "image" || nodeType === "video";
    if (taskType === "audio") return nodeType === "audio";
    return false;
}

export function isMediaReferenceType(type: CanvasTaskReferenceNode["type"]): type is AgentRunReference["type"] {
    return type === "image" || type === "video" || type === "audio";
}

function requestsSelectedTextEdit(prompt: string) {
    const normalized = prompt.replace(/(?:不要|无需|不需要|别)\s*(?:生成|生图|出图|制作)(?:图片|图像|画面|视频|音频)?/gu, "");
    const requestsEdit = /修改|改写|优化|润色|调整|重写|精简|扩写|翻译/u.test(normalized);
    const requestsMedia = /(?:生成|生图|出图|绘制|制作).{0,10}(?:图片|图像|画面|视频|音频)|(?:图片|图像|画面|视频|音频).{0,10}(?:生成|生图|出图|绘制|制作)/u.test(normalized);
    return requestsEdit && !requestsMedia;
}

function positiveNumber(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : undefined;
}

function exactImageSize(value: unknown) {
    const normalized = normalizeImageSizeValue(value);
    return parseImageDimensions(normalized) ? normalized : undefined;
}
