export const creativeSurfaces = ["chat", "canvas", "drama"] as const;
export type CreativeSurface = (typeof creativeSurfaces)[number];
export const creativeConversationSources = ["agent", "image-workbench", "video-workbench", "canvas", "drama"] as const;
export type CreativeConversationSource = (typeof creativeConversationSources)[number];

export type CreativeConversationStatus = "active" | "archived";
export type CreativeMessageRole = "user" | "assistant" | "system" | "tool";
export type CreativeMessageStatus = "running" | "completed" | "failed" | "cancelled";
export type CreativeAssetType = "text" | "image" | "video" | "audio";
export type CreativeAssetStatus = "ready" | "failed" | "deleted";

export type CreativeConversation = {
    id: string;
    userId: string;
    surface: CreativeSurface;
    source: CreativeConversationSource;
    projectId?: string;
    title: string;
    status: CreativeConversationStatus;
    contextSummary: string;
    contextSummaryThroughSequence: number;
    createdAt: number;
    updatedAt: number;
    lastMessageAt: number;
};

export type CreativeConversationContext = {
    summary: string;
    summaryThroughSequence: number;
    recentMessages: CreativeMessage[];
};

export type CreativeMessage = {
    id: string;
    conversationId: string;
    sequence: number;
    role: CreativeMessageRole;
    status: CreativeMessageStatus;
    content: string;
    runId?: string;
    metadata: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
};

export type CreativeAsset = {
    id: string;
    userId: string;
    conversationId: string;
    messageId?: string;
    sourceRunId?: string;
    sourceTaskId?: string;
    parentAssetId?: string;
    ordinal: number;
    type: CreativeAssetType;
    status: CreativeAssetStatus;
    title: string;
    textContent?: string;
    storageKind?: "local" | "object" | "remote";
    storageKey?: string;
    remoteUrl?: string;
    serverUrl?: string;
    mimeType?: string;
    width?: number;
    height?: number;
    durationMs?: number;
    bytes?: number;
    metadata: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
};

export type CreativeProjectHandoffSurface = "canvas" | "drama";

export type CreativeProjectHandoffPlan = {
    surface: CreativeProjectHandoffSurface;
    title: string;
    summary?: string;
    style?: string;
    ratio?: "9:16" | "16:9";
    assetIds?: string[];
};

export type CreativeProjectHandoff = {
    id: string;
    sourceRunId: string;
    conversationId: string;
    surface: CreativeProjectHandoffSurface;
    title: string;
    summary: string;
    style?: string;
    ratio?: "9:16" | "16:9";
    assetIds: string[];
    assets: CreativeAsset[];
};

export function isCreativeProjectHandoff(value: unknown): value is CreativeProjectHandoff {
    if (!value || typeof value !== "object") return false;
    const handoff = value as Record<string, unknown>;
    return (
        typeof handoff.id === "string" &&
        typeof handoff.sourceRunId === "string" &&
        typeof handoff.conversationId === "string" &&
        (handoff.surface === "canvas" || handoff.surface === "drama") &&
        typeof handoff.title === "string" &&
        typeof handoff.summary === "string" &&
        Array.isArray(handoff.assetIds) &&
        Array.isArray(handoff.assets)
    );
}

export type CreativeRunEvent = {
    id: string;
    runId: string;
    type: string;
    data?: unknown;
    createdAt: number;
};

export type CreativeRunRequest = {
    clientRequestId: string;
    surface: CreativeSurface;
    conversationId?: string;
    projectId?: string;
    prompt: string;
    snapshot?: unknown;
    assetIds: string[];
    skillIds: string[];
    modelIds: string[];
};

export class CreativeRuntimeInputError extends Error {
    constructor(
        message: string,
        public readonly status = 400,
    ) {
        super(message);
    }
}

const MAX_CLIENT_REQUEST_ID = 120;
const MAX_ID = 160;
const MAX_PROMPT = 4000;
const MAX_ASSETS = 20;
const MAX_SKILLS = 6;
const MAX_MODELS = 6;
const MAX_SNAPSHOT_BYTES = 512 * 1024;

export function normalizeCreativeRunRequest(value: unknown): CreativeRunRequest {
    const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const clientRequestId = text(input.clientRequestId, MAX_CLIENT_REQUEST_ID);
    const surface = normalizeCreativeSurface(input.surface);
    const conversationId = optionalText(input.conversationId, MAX_ID);
    const projectId = optionalText(input.projectId, MAX_ID);
    const prompt = text(input.prompt, MAX_PROMPT);
    const snapshot = input.snapshot;
    const assetIds = Array.from(new Set((Array.isArray(input.assetIds) ? input.assetIds : []).map((item) => optionalText(item, MAX_ID)).filter((item): item is string => Boolean(item))));
    const skillIds = Array.from(new Set((Array.isArray(input.skillIds) ? input.skillIds : []).map((item) => optionalText(item, MAX_ID)).filter((item): item is string => Boolean(item))));
    const modelIds = Array.from(new Set((Array.isArray(input.modelIds) ? input.modelIds : []).map((item) => optionalText(item, MAX_ID)).filter((item): item is string => Boolean(item))));
    if (!clientRequestId) throw new CreativeRuntimeInputError("请求标识不能为空");
    if (!surface) throw new CreativeRuntimeInputError("创作入口不正确");
    if (!prompt) throw new CreativeRuntimeInputError("创作需求不能为空");
    if (assetIds.length > MAX_ASSETS) throw new CreativeRuntimeInputError(`一次最多引用 ${MAX_ASSETS} 个资产`);
    if (skillIds.length > MAX_SKILLS) throw new CreativeRuntimeInputError(`一次最多启用 ${MAX_SKILLS} 个 Skill`);
    if (modelIds.length > MAX_MODELS) throw new CreativeRuntimeInputError(`一次最多选择 ${MAX_MODELS} 个模型`);
    if (surface === "chat" && (projectId || snapshot !== undefined)) throw new CreativeRuntimeInputError("普通对话不接受项目或快照");
    if (surface !== "chat" && !projectId) throw new CreativeRuntimeInputError(surface === "canvas" ? "画布标识不能为空" : "短剧项目标识不能为空");
    if (snapshot !== undefined && new TextEncoder().encode(JSON.stringify(snapshot)).length > MAX_SNAPSHOT_BYTES) throw new CreativeRuntimeInputError("当前项目快照过大", 413);

    return { clientRequestId, surface, conversationId, projectId, prompt, snapshot, assetIds, skillIds, modelIds };
}

export function normalizeCreativeSurface(value: unknown): CreativeSurface | null {
    return typeof value === "string" && creativeSurfaces.includes(value.trim() as CreativeSurface) ? (value.trim() as CreativeSurface) : null;
}

export function normalizeCreativeConversationSource(value: unknown): CreativeConversationSource | null {
    return typeof value === "string" && creativeConversationSources.includes(value.trim() as CreativeConversationSource) ? (value.trim() as CreativeConversationSource) : null;
}

export function creativeConversationSourceForSurface(surface: CreativeSurface): CreativeConversationSource {
    return surface === "canvas" || surface === "drama" ? surface : "agent";
}

export function isCreativeConversationSourceCompatible(surface: CreativeSurface, source: CreativeConversationSource) {
    return surface === "chat" ? source === "agent" || source === "image-workbench" || source === "video-workbench" : source === surface;
}

function text(value: unknown, max: number) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function optionalText(value: unknown, max: number) {
    return text(value, max) || undefined;
}
