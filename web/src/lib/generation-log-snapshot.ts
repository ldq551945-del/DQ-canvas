export type GenerationLogSnapshotParameters = {
    model?: string;
    size?: string;
    quality?: string;
    count?: string;
    resolution?: string;
    seconds?: string;
    generateAudio?: string;
    watermark?: string;
};

export type GenerationLogReferenceSnapshot = {
    id: string;
    kind: "image" | "video" | "audio";
    name: string;
    mimeType: string;
    url?: string;
    remoteUrl?: string;
    serverUrl?: string;
    storageKey?: string;
    bytes?: number;
    width?: number;
    height?: number;
    durationMs?: number;
};

export type GenerationLogSlotSnapshot = {
    id: string;
    index: number;
    status: "pending" | "success" | "failed";
    prompt?: string;
    parameters?: GenerationLogSnapshotParameters;
    referenceIds?: string[];
    assetIndex?: number;
    taskId?: string;
    taskKind?: "generation" | "edit";
    taskProvider?: "openai" | "seedance" | "generation";
    taskModel?: string;
    taskPollPath?: string;
    taskResultUrl?: string;
    serverTaskId?: string;
    startedAt?: number;
    error?: string;
    canRetry?: boolean;
};

export type GenerationLogRequestSnapshot = {
    version: 1;
    userPrompt?: string;
    parameters: GenerationLogSnapshotParameters;
    references: GenerationLogReferenceSnapshot[];
    slots: GenerationLogSlotSnapshot[];
};

export function generationLogPublicPrompt(log: { prompt?: string; creativeConversationId?: string; requestSnapshot?: Pick<GenerationLogRequestSnapshot, "userPrompt"> }) {
    const userPrompt = log.requestSnapshot?.userPrompt?.trim();
    if (userPrompt) return userPrompt;
    return log.creativeConversationId ? "" : String(log.prompt || "").trim();
}
