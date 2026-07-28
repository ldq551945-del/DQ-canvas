"use client";

import { nanoid } from "nanoid";
import { useEffect, useRef, type Dispatch, type DragEvent as ReactDragEvent, type SetStateAction } from "react";

import { droppedFiles, leftDropTarget, preventFileDragEvent } from "@/lib/file-drop";
import { uploadImage } from "@/services/image-storage";
import type { ReferenceImage } from "@/types/image";

type Notice = { error: (text: string) => void; success: (text: string) => void };

export function useImageReferenceInputs(input: { references: ReferenceImage[]; setReferences: Dispatch<SetStateAction<ReferenceImage[]>>; setDragActive: Dispatch<SetStateAction<boolean>>; notice: Notice }) {
    const previewUrlsRef = useRef(new Set<string>());
    const retrySourcesRef = useRef(new Map<string, { source: Blob; name: string }>());

    useEffect(() => {
        const activeUrls = new Set(input.references.map((item) => item.previewUrl).filter((url): url is string => Boolean(url)));
        for (const url of previewUrlsRef.current) {
            if (activeUrls.has(url)) continue;
            URL.revokeObjectURL(url);
            previewUrlsRef.current.delete(url);
        }
        const activeIds = new Set(input.references.map((item) => item.id));
        for (const id of retrySourcesRef.current.keys()) {
            if (!activeIds.has(id)) retrySourcesRef.current.delete(id);
        }
    }, [input.references]);

    useEffect(
        () => () => {
            for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
            previewUrlsRef.current.clear();
            retrySourcesRef.current.clear();
        },
        [],
    );

    const uploadReference = async (source: Blob, reference: ReferenceImage) => {
        input.setReferences((value) => value.map((item) => (item.id === reference.id ? { ...item, uploadStatus: "uploading", uploadError: undefined } : item)));
        try {
            const image = await uploadImage(source);
            const ready: ReferenceImage = {
                ...reference,
                type: image.mimeType,
                dataUrl: image.url,
                storageKey: image.storageKey,
                width: image.width,
                height: image.height,
                uploadStatus: undefined,
                uploadError: undefined,
            };
            retrySourcesRef.current.delete(reference.id);
            input.setReferences((value) => value.map((item) => (item.id === reference.id ? ready : item)));
            return ready;
        } catch (error) {
            const uploadError = error instanceof Error ? error.message : "参考图上传失败";
            input.setReferences((value) => value.map((item) => (item.id === reference.id ? { ...item, uploadStatus: "failed", uploadError } : item)));
            input.notice.error(uploadError);
            return null;
        }
    };

    const uploadReferences = async (items: Array<{ source: Blob; name: string }>) => {
        const pending = items.map(({ source, name }) => {
            const previewUrl = URL.createObjectURL(source);
            previewUrlsRef.current.add(previewUrl);
            return {
                source,
                reference: {
                    id: nanoid(),
                    name,
                    type: source.type || "image/png",
                    dataUrl: previewUrl,
                    previewUrl,
                    uploadStatus: "uploading" as const,
                } satisfies ReferenceImage,
            };
        });
        if (!pending.length) return [];
        pending.forEach(({ source, reference }) => retrySourcesRef.current.set(reference.id, { source, name: reference.name }));
        input.setReferences((value) => [...value, ...pending.map((item) => item.reference)]);
        const uploaded = await Promise.all(pending.map(({ source, reference }) => uploadReference(source, reference)));
        return uploaded.filter((item): item is ReferenceImage => Boolean(item));
    };

    const retryReferenceUpload = async (id: string) => {
        const pending = retrySourcesRef.current.get(id);
        const reference = input.references.find((item) => item.id === id);
        if (!pending || !reference) {
            input.notice.error("原始参考图已不可用，请重新选择文件");
            return null;
        }
        return uploadReference(pending.source, { ...reference, name: pending.name });
    };

    const addReferences = async (files?: FileList | File[] | null) => {
        return uploadReferences(
            Array.from(files || [])
                .filter((file) => file.type.startsWith("image/"))
                .map((file) => ({ source: file, name: file.name })),
        );
    };
    const handleReferenceDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
        if (preventFileDragEvent(event)) input.setDragActive(true);
    };
    const handleReferenceDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
        if (preventFileDragEvent(event) && leftDropTarget(event)) input.setDragActive(false);
    };
    const handleReferenceDrop = (event: ReactDragEvent<HTMLDivElement>) => {
        if (!preventFileDragEvent(event)) return;
        input.setDragActive(false);
        const files = droppedFiles(event, (file) => file.type.startsWith("image/"));
        if (files.length) void addReferences(files);
    };
    const addReferencesFromClipboard = async () => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) return input.notice.error("剪切板里没有可读取的图片");
            const next = await uploadReferences(blobs.map((blob, index) => ({ source: blob, name: `clipboard-${index + 1}.png` })));
            input.notice.success(`已读取 ${next.length} 张参考图`);
        } catch {
            input.notice.error("剪切板里没有可读取的图片");
        }
    };
    return { addReferences, retryReferenceUpload, addReferencesFromClipboard, handleReferenceDragOver, handleReferenceDragLeave, handleReferenceDrop };
}
