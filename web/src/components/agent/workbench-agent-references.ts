import { nanoid } from "nanoid";

import type { WorkbenchAgentAttachment } from "@/lib/workbench-agent-attachment";
import { serverMediaUrl } from "@/services/server-media-storage";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export function workbenchAttachmentsFromReferences(input: { images?: ReferenceImage[]; videos?: ReferenceVideo[]; audio?: ReferenceAudio[] }): WorkbenchAgentAttachment[] {
    return [
        ...(input.images || []).flatMap((item) => {
            if (item.uploadStatus || !item.storageKey) return [];
            const url = serverMediaUrl(item.storageKey, item.serverUrl || item.dataUrl);
            return url
                ? [
                      {
                          kind: "image" as const,
                          name: item.name,
                          url,
                          storageKey: item.storageKey,
                          mimeType: item.type,
                          width: item.width,
                          height: item.height,
                      },
                  ]
                : [];
        }),
        ...(input.videos || []).flatMap((item) => {
            if (!item.storageKey) return [];
            const url = serverMediaUrl(item.storageKey, item.url);
            return url
                ? [
                      {
                          kind: "video" as const,
                          name: item.name,
                          url,
                          storageKey: item.storageKey,
                          mimeType: item.type,
                          width: item.width,
                          height: item.height,
                          durationMs: item.durationMs,
                      },
                  ]
                : [];
        }),
        ...(input.audio || []).flatMap((item) => {
            if (!item.storageKey) return [];
            const url = serverMediaUrl(item.storageKey, item.url);
            return url ? [{ kind: "audio" as const, name: item.name, url, storageKey: item.storageKey, mimeType: item.type, durationMs: item.durationMs }] : [];
        }),
    ];
}

export function workbenchReferencesFromAttachments(attachments: WorkbenchAgentAttachment[] | undefined) {
    const images: ReferenceImage[] = [];
    const videos: ReferenceVideo[] = [];
    const audio: ReferenceAudio[] = [];
    for (const item of attachments || []) {
        const id = nanoid();
        if (item.kind === "image") {
            images.push({ id, name: item.name, type: item.mimeType, dataUrl: item.url, serverUrl: item.url, storageKey: item.storageKey, width: item.width, height: item.height });
        } else if (item.kind === "video") {
            videos.push({ id, name: item.name, type: item.mimeType, url: item.url, storageKey: item.storageKey, width: item.width, height: item.height, durationMs: item.durationMs });
        } else {
            audio.push({ id, name: item.name, type: item.mimeType, url: item.url, storageKey: item.storageKey, durationMs: item.durationMs });
        }
    }
    return { images, videos, audio };
}
