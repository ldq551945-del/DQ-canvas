"use client";

import { nanoid } from "nanoid";
import type { Dispatch, DragEvent as ReactDragEvent, SetStateAction } from "react";

import { droppedFiles, leftDropTarget, preventFileDragEvent } from "@/lib/file-drop";
import { uploadImage } from "@/services/image-storage";
import type { ReferenceImage } from "@/types/image";

type Notice = { error: (text: string) => void; success: (text: string) => void };

export function useImageReferenceInputs(input: { references: ReferenceImage[]; setReferences: Dispatch<SetStateAction<ReferenceImage[]>>; setDragActive: Dispatch<SetStateAction<boolean>>; notice: Notice }) {
    const addReferences = async (files?: FileList | File[] | null) => {
        const next = await Promise.all(
            Array.from(files || [])
                .filter((file) => file.type.startsWith("image/"))
                .map(async (file) => {
                    const image = await uploadImage(file);
                    return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
        );
        input.setReferences((value) => [...value, ...next]);
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
            const next = await Promise.all(
                blobs.map(async (blob, index) => {
                    const image = await uploadImage(blob);
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            input.setReferences((value) => [...value, ...next]);
            input.notice.success(`已读取 ${next.length} 张参考图`);
        } catch {
            input.notice.error("剪切板里没有可读取的图片");
        }
    };
    return { addReferences, addReferencesFromClipboard, handleReferenceDragOver, handleReferenceDragLeave, handleReferenceDrop };
}
