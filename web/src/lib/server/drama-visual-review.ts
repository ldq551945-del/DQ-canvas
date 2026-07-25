import type { CreativeFoundation } from "@/lib/creative-agent-contract";
import type { CreativeReviewTaskInput } from "@/lib/server/creative-review-service";

export function normalizeDramaVisualReviewInput(value: unknown): { foundation: CreativeFoundation; tasks: CreativeReviewTaskInput[] } {
    const input = object(value);
    const project = object(input.project);
    const episode = object(input.episode);
    const style = text(project.style, 500);
    const ratio = text(project.ratio, 20);
    const tasks = array(episode.shots)
        .slice(0, 20)
        .flatMap((item) => {
            const shot = object(item);
            const id = text(shot.id, 160);
            const imageUrls = [mediaUrl(shot.storyboardImageUrl), mediaUrl(shot.storyboardEndImageUrl)].filter(Boolean);
            if (!id || !imageUrls.length) return [];
            return [
                {
                    id,
                    title: text(shot.title, 160) || "未命名镜头",
                    type: "image" as const,
                    prompt: text(shot.compiledPrompt, 8000) || text(shot.imagePrompt, 8000) || text(shot.description, 4000),
                    resultSummary: imageUrls.length > 1 ? "已生成起始帧和结束帧" : "已生成分镜图",
                    imageUrls,
                },
            ];
        })
        .slice(0, 6);
    return {
        foundation: {
            complexity: "complex",
            brief: {
                objective: `${text(project.title, 160) || "短剧"} · ${text(episode.title, 160) || "当前剧集"}分镜一致性检查`,
                coreMessage: text(project.summary, 1000),
                constraints: [`画幅 ${ratio || "未指定"}`, "角色身份、服装、道具、空间、视线和轴线应在相邻镜头中保持连续"],
                referenceStrategy: "以项目资产设定和相邻镜头为一致性基准",
            },
            direction: {
                summary: style || "保持镜头叙事清晰、主体稳定、相邻画面连续",
                style,
                composition: "检查景别、构图、人物站位、视线和屏幕运动方向",
                avoid: ["角色身份漂移", "服装或道具无依据变化", "空间关系跳变", "轴线与视线错误", "文字和水印"],
            },
        },
        tasks,
    };
}

function mediaUrl(value: unknown) {
    const url = text(value, 4000);
    return url.startsWith("/api/") || /^https:\/\//i.test(url) || /^data:image\//i.test(url) ? url : "";
}

function object(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function array(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function text(value: unknown, max: number) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}
