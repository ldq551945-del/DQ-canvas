import { normalizeBackgroundRemovalOptions, type BackgroundRemovalModel, type BackgroundRemovalOptionsV1 } from "@/lib/background-removal-options";
import type { BackgroundRemovalProgressStage } from "@/lib/background-removal-progress";
import { serverMediaUrl } from "@/services/server-media-storage";
import type { UploadedImage } from "@/services/image-storage";

export type BackgroundRemovalTaskStatus = "pending" | "running" | "success" | "error" | "cancelled";

type BackgroundRemovalResult = {
    storageKey?: string;
    serverUrl?: string;
    url?: string;
    width?: number;
    height?: number;
    bytes?: number;
    mimeType?: string;
    options?: BackgroundRemovalOptionsV1;
    optionsHash?: string;
    model?: BackgroundRemovalModel;
};

export type BackgroundRemovalTask = {
    id: string;
    status: BackgroundRemovalTaskStatus;
    result?: BackgroundRemovalResult;
    error?: string;
    progress?: number;
    progressStage?: BackgroundRemovalProgressStage;
    stage?: string;
    sourceStorageKey?: string;
    sourceNodeId?: string;
    projectId?: string;
    options?: BackgroundRemovalOptionsV1;
    optionsHash?: string;
    model?: BackgroundRemovalModel;
};

type BackgroundRemovalPayload = {
    code?: number;
    data?: { task?: BackgroundRemovalTask; cancellationConfirmed?: boolean };
    task?: BackgroundRemovalTask;
    msg?: string;
    error?: string;
};

const POLL_INTERVAL_MS = 1200;
const TIMEOUT_MS = 10 * 60 * 1000;

export type BackgroundRemovalImage = UploadedImage & {
    backgroundRemovalOptions: BackgroundRemovalOptionsV1;
    backgroundRemovalOptionsHash: string;
};

export class BackgroundRemovalTaskTerminalError extends Error {
    readonly terminal = true;

    constructor(
        message: string,
        readonly status: "error" | "cancelled",
    ) {
        super(message);
        this.name = "BackgroundRemovalTaskTerminalError";
    }
}

export type BackgroundRemovalTaskInput = {
    sourceStorageKey: string;
    projectId: string;
    sourceNodeId: string;
    options?: BackgroundRemovalOptionsV1;
    signal?: AbortSignal;
    onTaskCreated?: (task: { id: string; type: "image_process" }) => void;
};

export async function createBackgroundRemovalTask(input: BackgroundRemovalTaskInput): Promise<BackgroundRemovalTask> {
    const sourceStorageKey = input.sourceStorageKey.trim();
    const projectId = input.projectId.trim();
    const sourceNodeId = input.sourceNodeId.trim();
    if (!sourceStorageKey) throw new Error("图片尚未保存到媒体存储");
    if (!projectId || !sourceNodeId) throw new Error("抠图必须关联画布项目和源节点");
    const options = { ...normalizeBackgroundRemovalOptions(input.options), outputMode: "transparent" as const };

    const response = await fetch("/api/background-removal-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            sourceStorageKey,
            options,
            context: {
                projectId,
                sourceNodeId,
                clientRequestId: `canvas-background-removal:${sourceNodeId}`,
            },
        }),
    });
    const created = await readPayload(response, "创建抠图任务失败");
    const task = created.data?.task || created.task;
    if (!task?.id) throw new Error(created.msg || created.error || "创建抠图任务失败");
    input.onTaskCreated?.({ id: task.id, type: "image_process" });
    if (input.signal?.aborted) {
        await cancelBackgroundRemovalTask(task.id);
        throw new DOMException("请求已取消", "AbortError");
    }
    return task;
}

export async function cancelBackgroundRemovalTask(id: string) {
    const taskId = id.trim();
    if (!taskId) throw new Error("缺少抠图任务标识");
    const response = await fetch(`/api/background-removal-tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
        cache: "no-store",
    });
    const payload = await readPayload(response, "终止抠图任务失败");
    if (payload.data?.cancellationConfirmed !== true) throw new Error(payload.msg || "服务端尚未确认抠图任务已终止");
    return payload.data.task;
}

export async function waitForBackgroundRemovalTask(id: string, options?: BackgroundRemovalOptionsV1, signal?: AbortSignal): Promise<BackgroundRemovalImage> {
    const completed = await pollBackgroundRemovalTask(id, signal);
    const result = completed.result;
    if (!result?.storageKey || !result.width || !result.height) throw new Error("抠图任务没有返回有效图片");
    const resultOptions = normalizeBackgroundRemovalOptions(result.options || options);
    const resultOptionsHash = typeof result.optionsHash === "string" && /^[a-f0-9]{64}$/.test(result.optionsHash) ? result.optionsHash : "";
    if (!resultOptionsHash) throw new Error("抠图任务没有返回有效参数快照");
    const url = result.serverUrl || result.url || serverMediaUrl(result.storageKey);
    return {
        url,
        storageKey: result.storageKey,
        serverUrl: result.serverUrl || url,
        width: Math.max(1, Math.floor(result.width)),
        height: Math.max(1, Math.floor(result.height)),
        bytes: Math.max(0, Math.floor(result.bytes || 0)),
        mimeType: result.mimeType || "image/png",
        backgroundRemovalOptions: resultOptions,
        backgroundRemovalOptionsHash: resultOptionsHash,
    };
}

export async function removeBackgroundImage(input: BackgroundRemovalTaskInput): Promise<BackgroundRemovalImage> {
    const options = { ...normalizeBackgroundRemovalOptions(input.options), outputMode: "transparent" as const };
    const task = await createBackgroundRemovalTask({ ...input, options });
    try {
        return await waitForBackgroundRemovalTask(task.id, options, input.signal);
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") await cancelBackgroundRemovalTask(task.id);
        throw error;
    }
}

async function pollBackgroundRemovalTask(id: string, signal?: AbortSignal) {
    const startedAt = Date.now();
    for (;;) {
        if (signal?.aborted) throw new DOMException("请求已取消", "AbortError");
        if (Date.now() - startedAt > TIMEOUT_MS) throw new Error("抠图任务超时，请稍后重试");
        const response = await fetch(`/api/background-removal-tasks/${encodeURIComponent(id)}`, { cache: "no-store", signal });
        const payload = await readPayload(response, "读取抠图任务失败");
        const task = payload.data?.task || payload.task;
        if (!task) throw new Error(payload.msg || payload.error || "抠图任务不存在");
        if (task.status === "success") return task;
        if (task.status === "error" || task.status === "cancelled") throw new BackgroundRemovalTaskTerminalError(task.error || (task.status === "cancelled" ? "抠图任务已取消" : "抠图失败"), task.status);
        await delay(POLL_INTERVAL_MS, signal);
    }
}

async function readPayload(response: Response, fallback: string) {
    const payload = (await response.json().catch(() => ({}))) as BackgroundRemovalPayload;
    if (!response.ok || (typeof payload.code === "number" && payload.code !== 0)) {
        throw new Error(payload.msg || payload.error || `${fallback}（${response.status}）`);
    }
    return payload;
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("请求已取消", "AbortError"));
            return;
        }
        const onAbort = () => {
            window.clearTimeout(timer);
            reject(new DOMException("请求已取消", "AbortError"));
        };
        const timer = window.setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}
