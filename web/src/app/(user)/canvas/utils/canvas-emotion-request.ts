import { resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeData, CanvasNodeMetadata } from "../types";

type EmotionSourceDescriptor = Pick<NonNullable<CanvasNodeMetadata["emotionEdit"]>, "sourceNodeId" | "sourceStorageKey" | "sourceContent">;
type CanvasEmotionSourceNode = CanvasNodeData & { metadata: CanvasNodeMetadata & { content: string } };

export function resolveEmotionEditRequestConfig(generationConfig: AiConfig) {
    const requestConfig = resolveModelRequestConfig(generationConfig, generationConfig.model);
    const protocol = requestConfig.advancedConfig?.protocol;
    const advanced = requestConfig.advancedConfig;
    const referenceRule = advanced?.referenceRule?.toLowerCase() || "";
    const explicitlySupportsMask = /\bmask\b|\u8499\u7248/.test(`${advanced?.requestTemplate || ""}\n${referenceRule}`);
    const multipartEditPath = /\/(?:v1\/)?images\/edits(?:\?|$)/i.test(advanced?.editPath || "");
    const standardMultipartEdit = protocol !== "sub2api" && Boolean(advanced?.editPath) && (multipartEditPath || /\bmultipart\b|form-?data/.test(referenceRule)) && !/\bjson\b|public|url\s*only|\u516c\u7f51|\u4ec5.*url|\u53ea.*url/.test(referenceRule);
    const supportsMaskedOpenAiEdit = requestConfig.apiFormat === "openai" && Boolean(advanced?.supportsReferenceImage) && (standardMultipartEdit || explicitlySupportsMask);
    return { requestConfig, supportsMaskedOpenAiEdit };
}

export function emotionSourceIdentity(node: CanvasNodeData) {
    return {
        sourceStorageKey: node.metadata?.storageKey?.trim() || undefined,
        sourceContent: node.metadata?.content || undefined,
    };
}

export function sameEmotionSource(emotionEdit: EmotionSourceDescriptor, node: CanvasNodeData | undefined) {
    if (!node?.metadata?.content || node.id !== emotionEdit.sourceNodeId) return false;
    const currentIdentity = emotionSourceIdentity(node);
    return emotionEdit.sourceStorageKey ? emotionEdit.sourceStorageKey === currentIdentity.sourceStorageKey : !emotionEdit.sourceContent || emotionEdit.sourceContent === currentIdentity.sourceContent;
}

export function resolveEmotionSource(emotionEdit: EmotionSourceDescriptor, nodes: readonly CanvasNodeData[], action: "complete" | "retry" = "complete"): CanvasEmotionSourceNode {
    const source = nodes.find((node) => node.id === emotionEdit.sourceNodeId);
    const missingMessage = action === "retry" ? "情绪编辑源图片已删除，无法重试" : "情绪编辑源图片已删除，无法恢复局部合成结果";
    if (!source?.metadata?.content) throw new Error(missingMessage);

    if (!sameEmotionSource(emotionEdit, source)) {
        throw new Error(action === "retry" ? "情绪编辑源图片已变化，请重新选择表情后重试" : "情绪编辑源图片已变化，未应用旧任务结果");
    }
    return source as CanvasEmotionSourceNode;
}

export async function resolveEmotionFirstRetryInputs<T>(emotionEdit: EmotionSourceDescriptor | undefined, nodes: readonly CanvasNodeData[], resolveStandardReferences: () => Promise<T>) {
    if (!emotionEdit) return { kind: "standard" as const, references: await resolveStandardReferences() };

    const source = resolveEmotionSource(emotionEdit, nodes, "retry");
    return { kind: "emotion" as const, source };
}
