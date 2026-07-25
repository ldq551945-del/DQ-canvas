"use client";

import { useState } from "react";
import { Image, Modal } from "antd";
import { Maximize2, PlayCircle } from "lucide-react";

import { imagePreviewUrl } from "@/lib/media-image-url";
import { cn } from "@/lib/utils";

export function AgentMediaPreview({ type, url, title, className }: { type: "text" | "image" | "video" | "audio"; url: string; title: string; className?: string }) {
    const [videoOpen, setVideoOpen] = useState(false);
    if (type === "image") {
        const thumbnailUrl = imagePreviewUrl(url, 960);
        const largePreviewUrl = imagePreviewUrl(url, 1920);
        return (
            <div className={cn("group/media relative overflow-hidden", className)}>
                <Image
                    rootClassName="!block !h-full !w-full cursor-zoom-in overflow-hidden"
                    src={thumbnailUrl}
                    alt={title}
                    className="!block !h-full !w-full object-cover"
                    preview={{
                        src: largePreviewUrl,
                        mask: (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-white">
                                <Maximize2 className="size-3.5" />
                                查看大图
                            </span>
                        ),
                    }}
                />
            </div>
        );
    }
    if (type === "video") {
        return (
            <>
                <div className={cn("group/media relative overflow-hidden bg-black text-white", className)}>
                    <button type="button" className="block size-full" onClick={() => setVideoOpen(true)} aria-label={`打开视频：${title}`}>
                        <video src={url} muted playsInline preload="metadata" className="size-full object-cover" />
                        <span className="absolute inset-0 grid place-items-center bg-black/10 transition group-hover/media:bg-black/20">
                            <span className="grid size-11 place-items-center rounded-full bg-black/55 shadow-sm backdrop-blur-sm">
                                <PlayCircle className="size-6" />
                            </span>
                        </span>
                        <span className="absolute right-2 top-2 grid size-7 place-items-center rounded-md bg-black/55 opacity-80 backdrop-blur-sm">
                            <Maximize2 className="size-3.5" />
                        </span>
                    </button>
                </div>
                <Modal title={title} open={videoOpen} footer={null} centered destroyOnHidden width="min(960px, calc(100vw - 24px))" onCancel={() => setVideoOpen(false)} styles={{ body: { padding: 0, overflow: "hidden", background: "#000" } }}>
                    <video src={url} controls autoPlay playsInline preload="metadata" className="max-h-[78dvh] w-full bg-black object-contain" />
                </Modal>
            </>
        );
    }
    if (type === "audio") return <audio src={url} controls preload="metadata" className={cn("w-full", className)} />;
    return null;
}
