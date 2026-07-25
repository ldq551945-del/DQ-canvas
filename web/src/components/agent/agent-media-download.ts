import { saveAs } from "file-saver";

import { originalImageDownloadUrl, originalImageExtension } from "@/lib/media-image-url";

export type AgentMediaDownload = { type: "image" | "video"; url: string; title: string };

export function downloadAgentMedia(items: AgentMediaDownload[]) {
    items.forEach((item, index) => {
        const title = items.length > 1 ? `${item.title}-${index + 1}` : item.title;
        const url = item.type === "image" ? originalImageDownloadUrl(item.url) : item.url;
        saveAs(url, agentMediaDownloadName(item.type, title, item.url));
    });
}

export function agentMediaDownloadName(type: AgentMediaDownload["type"], title: string, url: string) {
    const fallbackExtension = type === "video" ? "mp4" : "png";
    const extension = type === "image" ? originalImageExtension(url) : url.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i)?.[1]?.toLowerCase() || fallbackExtension;
    const fallbackTitle = type === "video" ? "生成视频" : "生成图片";
    const safeTitle = (title.trim() || fallbackTitle)
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
        .replace(type === "image" ? /\.(?:png|jpe?g|webp|gif|avif|bmp)$/i : /\s+$/g, "")
        .replace(/[.\s]+$/g, "")
        .slice(0, 80);
    return safeTitle.toLowerCase().endsWith(`.${extension}`) ? safeTitle : `${safeTitle}.${extension}`;
}
