import type { ImageTaskReference } from "@/lib/server/image-task-store";
import { GENERATION_TASK_RETENTION_MS } from "@/lib/server/generation-task-retention";
import { deleteLocalMediaAssetsByStorageKeys } from "@/lib/server/local-media-storage";
import { writeReferenceImageDataUrl } from "@/lib/server/reference-asset-store";

export const IMAGE_TASK_REFERENCE_TTL_MS = GENERATION_TASK_RETENTION_MS;

type ImageTaskReferenceContext = {
    ownerUserId: string;
    taskId: string;
    conversationId?: string;
    runId?: string;
    projectId?: string;
};

export async function persistImageTaskReferencePayload(references: ImageTaskReference[], mask: ImageTaskReference | undefined, context: ImageTaskReferenceContext) {
    const storageKeys: string[] = [];
    try {
        const storedReferences: ImageTaskReference[] = [];
        for (const reference of references) {
            const stored = await persistInlineReference(reference, context);
            storedReferences.push(stored.reference);
            if (stored.storageKey) storageKeys.push(stored.storageKey);
        }
        const storedMask = mask ? await persistInlineReference(mask, context) : undefined;
        if (storedMask?.storageKey) storageKeys.push(storedMask.storageKey);
        return { references: storedReferences, mask: storedMask?.reference, storageKeys };
    } catch (error) {
        await cleanupImageTaskReferencePayload(storageKeys);
        throw error;
    }
}

export async function cleanupImageTaskReferencePayload(storageKeys: string[]) {
    if (!storageKeys.length) return;
    await deleteLocalMediaAssetsByStorageKeys(storageKeys, "reference").catch(() => undefined);
}

async function persistInlineReference(reference: ImageTaskReference, context: ImageTaskReferenceContext): Promise<{ reference: ImageTaskReference; storageKey?: string }> {
    const values = [reference.dataUrl, reference.url, reference.remoteUrl, reference.serverUrl].map((value) => value?.trim() || "");
    const dataUrl = values.find((value) => /^data:image\//i.test(value));
    if (!dataUrl) return { reference };

    const asset = await writeReferenceImageDataUrl(dataUrl, {
        ...context,
        source: "image-task-reference",
        originalName: reference.name,
        ttlMs: IMAGE_TASK_REFERENCE_TTL_MS,
    });
    const internalUrl = `/api/reference-assets/${asset.token
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/")}`;
    return {
        storageKey: asset.token,
        reference: {
            ...reference,
            type: asset.mimeType || reference.type,
            dataUrl: "",
            url: internalUrl,
            remoteUrl: undefined,
            serverUrl: internalUrl,
        },
    };
}
