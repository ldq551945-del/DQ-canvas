"use client";

import { nanoid } from "nanoid";
import type { Dispatch, DragEvent as ReactDragEvent, SetStateAction } from "react";

import { droppedFiles, leftDropTarget, preventFileDragEvent } from "@/lib/file-drop";
import { SEEDANCE_REFERENCE_LIMITS } from "@/lib/seedance-video";
import { cn } from "@/lib/utils";
import { uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { filterAudioReferencesByDuration, isSupportedAudioFile, type ReferenceDropTarget } from "./video-workbench-records";

type Notice = { warning: (text: string) => void; error: (text: string) => void; success: (text: string) => void };

export function useVideoReferenceInputs(input: {
    references: ReferenceImage[];
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
    referenceDragTarget: ReferenceDropTarget | null;
    setReferences: Dispatch<SetStateAction<ReferenceImage[]>>;
    setVideoReferences: Dispatch<SetStateAction<ReferenceVideo[]>>;
    setAudioReferences: Dispatch<SetStateAction<ReferenceAudio[]>>;
    setReferenceDragTarget: Dispatch<SetStateAction<ReferenceDropTarget | null>>;
    notice: Notice;
}) {
    const addReferences = async (files?: FileList | File[] | null) => {
        const selectedFiles = Array.from(files || []);
        const unsupported = selectedFiles.filter((file) => !file.type.startsWith("image/") && !file.type.startsWith("video/") && !isSupportedAudioFile(file));
        if (unsupported.length) input.notice.warning("已忽略不支持的参考素材，请使用图片、mp4/mov 视频或 mp3/wav 音频");
        const imageFiles = selectedFiles.filter((file) => file.type.startsWith("image/") && file.size <= SEEDANCE_REFERENCE_LIMITS.imageMaxBytes).slice(0, SEEDANCE_REFERENCE_LIMITS.images - input.references.length);
        const videoFiles = selectedFiles.filter((file) => file.type.startsWith("video/") && file.size <= SEEDANCE_REFERENCE_LIMITS.videoMaxBytes).slice(0, SEEDANCE_REFERENCE_LIMITS.videos - input.videoReferences.length);
        const audioFiles = selectedFiles.filter((file) => isSupportedAudioFile(file) && file.size <= SEEDANCE_REFERENCE_LIMITS.audioMaxBytes).slice(0, SEEDANCE_REFERENCE_LIMITS.audios - input.audioReferences.length);
        if (selectedFiles.some((file) => file.type.startsWith("image/") && file.size > SEEDANCE_REFERENCE_LIMITS.imageMaxBytes)) input.notice.warning("已忽略超过 30MB 的参考图");
        if (selectedFiles.some((file) => file.type.startsWith("video/") && file.size > SEEDANCE_REFERENCE_LIMITS.videoMaxBytes)) input.notice.warning("已忽略超过 50MB 的参考视频");
        if (selectedFiles.some((file) => isSupportedAudioFile(file) && file.size > SEEDANCE_REFERENCE_LIMITS.audioMaxBytes)) input.notice.warning("已忽略超过 15MB 的参考音频");
        const nextReferences = await Promise.all(
            imageFiles.map(async (file) => {
                const image = await uploadImage(file);
                return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
            }),
        );
        const nextVideoReferences = await Promise.all(
            videoFiles.map(async (file) => {
                const video = await uploadMediaFile(file, "video-reference");
                return { id: nanoid(), name: file.name, type: video.mimeType, url: video.url, storageKey: video.storageKey, bytes: video.bytes, width: video.width, height: video.height, durationMs: video.durationMs };
            }),
        );
        const nextAudioReferences = filterAudioReferencesByDuration(
            input.audioReferences,
            await Promise.all(
                audioFiles.map(async (file) => {
                    const audio = await uploadMediaFile(file, "audio-reference");
                    return { id: nanoid(), name: file.name, type: audio.mimeType, url: audio.url, storageKey: audio.storageKey, durationMs: audio.durationMs };
                }),
            ),
            input.notice.warning,
        );
        input.setReferences((value) => [...value, ...nextReferences].slice(0, SEEDANCE_REFERENCE_LIMITS.images));
        input.setVideoReferences((value) => [...value, ...nextVideoReferences].slice(0, SEEDANCE_REFERENCE_LIMITS.videos));
        input.setAudioReferences((value) => [...value, ...nextAudioReferences].slice(0, SEEDANCE_REFERENCE_LIMITS.audios));
    };

    const accepted = (target: ReferenceDropTarget, file: File) => (target === "image" ? file.type.startsWith("image/") : target === "video" ? file.type.startsWith("video/") : isSupportedAudioFile(file));
    const handleReferenceDragOver = (target: ReferenceDropTarget) => (event: ReactDragEvent<HTMLDivElement>) => {
        if (preventFileDragEvent(event)) input.setReferenceDragTarget(target);
    };
    const handleReferenceDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
        if (preventFileDragEvent(event) && leftDropTarget(event)) input.setReferenceDragTarget(null);
    };
    const handleReferenceDrop = (target: ReferenceDropTarget) => (event: ReactDragEvent<HTMLDivElement>) => {
        if (!preventFileDragEvent(event)) return;
        input.setReferenceDragTarget(null);
        const files = droppedFiles(event, (file) => accepted(target, file));
        if (files.length) void addReferences(files);
    };
    const addReferencesFromClipboard = async () => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) return input.notice.error("剪切板里没有可读取的图片");
            const next = await Promise.all(
                blobs.slice(0, SEEDANCE_REFERENCE_LIMITS.images - input.references.length).map(async (blob, index) => {
                    const image = await uploadImage(blob);
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            input.setReferences((value) => [...value, ...next].slice(0, SEEDANCE_REFERENCE_LIMITS.images));
            input.notice.success(`已读取 ${next.length} 张参考图`);
        } catch {
            input.notice.error("剪切板里没有可读取的图片");
        }
    };
    const referenceDropZoneClass = (target: ReferenceDropTarget) =>
        cn(
            "hover-scrollbar hover-scrollbar-hint flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed border-stone-300 p-2 pb-3 overscroll-x-contain transition dark:border-stone-700",
            input.referenceDragTarget === target && "border-cyan-400 bg-cyan-50/60 ring-1 ring-cyan-200 dark:border-cyan-400 dark:bg-cyan-500/10 dark:ring-cyan-400/25",
        );
    return { addReferences, addReferencesFromClipboard, handleReferenceDragOver, handleReferenceDragLeave, handleReferenceDrop, referenceDropZoneClass, referenceFileAccepted: accepted };
}
