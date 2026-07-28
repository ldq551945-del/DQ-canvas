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
};

export type GenerationLogRequestSnapshot = {
    version: 1;
    parameters: GenerationLogSnapshotParameters;
    references: GenerationLogReferenceSnapshot[];
    slots: GenerationLogSlotSnapshot[];
};
