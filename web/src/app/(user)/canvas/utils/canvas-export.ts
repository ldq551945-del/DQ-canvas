import { saveAs } from "file-saver";

import { createZip } from "@/lib/zip";
import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import { APP_EXPORT_ID, collectStorageKeys } from "@/lib/storage-keys";
import { exportFileExtension, safeExportFileName } from "@/lib/export-file";
import { mediaDownloadFileName } from "@/lib/media-file";
import type { CanvasExportAsset, CanvasExportFile } from "../export-types";
import type { CanvasProject } from "../stores/use-canvas-store";

type ImportedCanvasMedia = { storageKey: string; url: string };

export function remapImportedProjectMedia(project: CanvasProject, uploaded: ReadonlyMap<string, ImportedCanvasMedia>) {
    const visit = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(visit);
        if (!value || typeof value !== "object") return value;
        const source = value as Record<string, unknown>;
        const next = Object.fromEntries(Object.entries(source).map(([key, item]) => [key, visit(item)]));
        const media = typeof source.storageKey === "string" ? uploaded.get(source.storageKey) : undefined;
        if (media) {
            next.storageKey = media.storageKey;
            next.serverUrl = media.url;
            delete next.remoteUrl;
            if ("content" in source) next.content = media.url;
            if ("dataUrl" in source) next.dataUrl = media.url;
            if ("url" in source) next.url = media.url;
        }

        const assetMeta = source.typeName === "asset" ? asRecord(source.meta) : undefined;
        const assetMedia = typeof assetMeta?.storageKey === "string" ? uploaded.get(assetMeta.storageKey) : undefined;
        if (assetMedia) {
            next.meta = { ...asRecord(next.meta), storageKey: assetMedia.storageKey };
            next.props = { ...asRecord(next.props), src: assetMedia.url };
        }
        return next;
    };
    return visit(project) as CanvasProject;
}

export async function exportCanvasProjects(projects: CanvasProject[]) {
    const zipFiles: { name: string; data: BlobPart }[] = [];
    const exportedProjects = await Promise.all(
        projects.map(async (project) => {
            const files: CanvasExportAsset[] = [];
            await Promise.all(
                Array.from(collectStorageKeys(project, (key) => key.startsWith("permanent/") || key.startsWith("temporary/"))).map(async (storageKey) => {
                    const blob = storageKey.includes("/images/") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
                    if (!blob) return;
                    const path = `projects/${project.id}/files/${safeExportFileName(storageKey)}.${exportFileExtension(blob.type, storageKey)}`;
                    files.push({ storageKey, path, mimeType: blob.type || "application/octet-stream", bytes: blob.size });
                    zipFiles.push({ name: path, data: blob });
                }),
            );
            return { project, files };
        }),
    );

    const data: CanvasExportFile = { app: APP_EXPORT_ID, version: 3, exportedAt: new Date().toISOString(), projects: exportedProjects };
    const zip = await createZip([{ name: "projects.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
    saveAs(zip, mediaDownloadFileName(projects.map((project) => project.id).join(":"), "application/zip"));
}

function asRecord(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
