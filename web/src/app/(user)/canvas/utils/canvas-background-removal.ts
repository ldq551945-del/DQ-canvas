import { normalizeBackgroundRemovalOptions, serializeBackgroundRemovalOptions, type BackgroundRemovalOptionsV1 } from "@/lib/background-removal-options";
import { CanvasNodeType, type CanvasBackgroundRemovalTask, type CanvasNodeData } from "../types";

export async function hashBackgroundRemovalOptions(options: BackgroundRemovalOptionsV1) {
    const serialized = serializeBackgroundRemovalOptions(options);
    if (!globalThis.crypto?.subtle) return "";
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export function findReusableBackgroundRemovalNode(nodes: CanvasNodeData[], input: { sourceNodeId: string; sourceStorageKey: string; options: BackgroundRemovalOptionsV1; optionsHash: string }) {
    if (!/^[a-f0-9]{64}$/.test(input.optionsHash)) return null;
    const serialized = serializeBackgroundRemovalOptions(input.options);
    return (
        nodes.find((node) => {
            if (
                node.type !== CanvasNodeType.Image ||
                node.metadata?.derivedOperation !== "remove-background" ||
                node.metadata.sourceNodeId !== input.sourceNodeId ||
                node.metadata.sourceStorageKey !== input.sourceStorageKey ||
                node.metadata.backgroundRemovalOptionsHash !== input.optionsHash ||
                !node.metadata.backgroundRemovalOptions
            ) {
                return false;
            }
            try {
                return serializeBackgroundRemovalOptions(normalizeBackgroundRemovalOptions(node.metadata.backgroundRemovalOptions)) === serialized;
            } catch {
                return false;
            }
        }) || null
    );
}

export function backgroundRemovalTaskSourceMatches(node: CanvasNodeData | undefined, task: CanvasBackgroundRemovalTask) {
    return Boolean(
        node &&
        node.id === task.sourceNodeId &&
        node.metadata?.storageKey?.trim() === task.sourceStorageKey &&
        node.metadata.content === task.sourceContent &&
        node.metadata.naturalWidth === task.sourceNaturalWidth &&
        node.metadata.naturalHeight === task.sourceNaturalHeight &&
        node.metadata.bytes === task.sourceBytes,
    );
}
