import type { BackgroundRemovalModel, BackgroundRemovalOptionsV1 } from "@/lib/background-removal-options";
import type { BackgroundRemovalProgressStage } from "@/lib/background-removal-progress";
import type { CanvasEmotionEditRegion, CanvasFaceBox } from "./utils/canvas-emotion";
import type { PortraitTextureSettings } from "./utils/canvas-portrait-texture";

export type Position = {
    x: number;
    y: number;
};

export type ViewportTransform = {
    x: number;
    y: number;
    k: number;
};

export enum CanvasNodeType {
    Image = "image",
    Panorama = "panorama",
    Drawing = "drawing",
    Text = "text",
    Config = "config",
    Video = "video",
    Audio = "audio",
    Brief = "brief",
    Task = "task",
    BrandKit = "brand-kit",
}

export function isCanvasImageNodeType(type: CanvasNodeType | null | undefined) {
    return type === CanvasNodeType.Image || type === CanvasNodeType.Panorama;
}

export function isCanvasDrawingNodeType(type: CanvasNodeType | null | undefined) {
    return type === CanvasNodeType.Drawing;
}

export type CanvasBackgroundRemovalTask = {
    id: string;
    sourceNodeId: string;
    sourceStorageKey: string;
    sourceContent: string;
    sourceNaturalWidth?: number;
    sourceNaturalHeight?: number;
    sourceBytes?: number;
    options: BackgroundRemovalOptionsV1;
    optionsHash?: string;
    model?: BackgroundRemovalModel;
    progressStage?: BackgroundRemovalProgressStage;
    progress?: number;
    stage?: string;
};

export type CanvasDrawingPreview = {
    storageKey?: string;
    serverUrl?: string;
    mimeType: string;
    width: number;
    height: number;
    bytes?: number;
};

export type CanvasDrawingDocument = {
    schemaVersion: 1;
    snapshot: unknown;
    revision: number;
    updatedAt: string;
    shapeCount: number;
    pageCount: number;
};

type CanvasNodeStatus = "idle" | "success" | "loading" | "error" | "cancelled";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasImageGenerationType = "generation" | "edit";

export type CameraControlOptions = {
    enabled: boolean;
    camera: string;
    lens: string;
    focalLength: number;
    aperture: number;
};

export type CanvasNodeMetadata = {
    drawingId?: string;
    drawingDocument?: CanvasDrawingDocument;
    drawingPreview?: CanvasDrawingPreview;
    agentRunId?: string;
    agentTaskId?: string;
    agentGenerationTaskIds?: string[];
    agentTaskStatus?: "ready" | "pending" | "running" | "paused" | "waiting_user" | "completed" | "failed" | "cancelled";
    agentTaskType?: CanvasGenerationMode;
    agentTaskDependencies?: string[];
    agentTaskOutputNodeIds?: string[];
    agentTaskAttempts?: number;
    agentTaskError?: string;
    agentBrief?: {
        objective: string;
        audience?: string;
        usage?: string;
        coreMessage?: string;
        referenceStrategy?: string;
        tone?: string[];
        deliverables?: Array<{ type: string; title: string; count?: number; ratio?: string; requirements?: string[] }>;
        constraints?: string[];
    };
    brandKit?: {
        summary?: string;
        style?: string;
        composition?: string;
        colors?: string[];
        lighting?: string;
        keywords?: string[];
        visualKeywords?: string[];
        avoid?: string[];
        typography?: string[];
        approvedNodeIds?: string[];
        rejectedNodeIds?: string[];
    };
    content?: string;
    composerContent?: string;
    prompt?: string;
    sourcePrompt?: string;
    status?: CanvasNodeStatus;
    locked?: boolean;
    errorDetails?: string;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    generationType?: CanvasImageGenerationType;
    model?: string;
    size?: string;
    quality?: string;
    count?: number;
    seconds?: string;
    vquality?: string;
    generateAudio?: string;
    watermark?: string;
    audioVoice?: string;
    audioFormat?: string;
    audioSpeed?: string;
    audioInstructions?: string;
    cameraControl?: CameraControlOptions;
    panoramaProjection?: "equirectangular";
    panoramaSourcePrompt?: string;
    references?: string[];
    skillIds?: string[];
    taskId?: string;
    taskStatus?: "pending" | "running" | "success" | "error" | "paused" | "cancelled";
    taskProgress?: number;
    taskStage?: string;
    taskCreatedAt?: number;
    taskStartedAt?: number;
    taskUpdatedAt?: number;
    taskDetails?: string;
    groupId?: string;
    videoStartFrameNodeId?: string;
    videoEndFrameNodeId?: string;
    naturalWidth?: number;
    naturalHeight?: number;
    freeResize?: boolean;
    isBatchRoot?: boolean;
    batchRootId?: string;
    batchChildIds?: string[];
    batchUsesReferenceImages?: boolean;
    primaryImageId?: string;
    imageBatchExpanded?: boolean;
    storageKey?: string;
    remoteUrl?: string;
    serverUrl?: string;
    mimeType?: string;
    bytes?: number;
    /** Local upload replacement is in flight; never persisted as a generation task. */
    mediaReplacing?: boolean;
    derivedOperation?: "remove-background" | "refine-background";
    sourceNodeId?: string;
    sourceStorageKey?: string;
    backgroundRemovalOptions?: BackgroundRemovalOptionsV1;
    backgroundRemovalOptionsHash?: string;
    /** Persisted server task that is resumed after reopening the canvas. */
    backgroundRemovalTask?: CanvasBackgroundRemovalTask;
    /** Prevents a terminal persisted task from being reattached after its result was handled. */
    backgroundRemovalHandledTaskId?: string;
    emotionEdit?: {
        sourceNodeId: string;
        sourceStorageKey?: string;
        sourceContent?: string;
        characterName: string;
        presetId: string;
        intimacy: number;
        arousal: number;
        label: string;
        faceBox: CanvasFaceBox;
        editRegion?: CanvasEmotionEditRegion;
        sourceWidth?: number;
        sourceHeight?: number;
        providerSize?: string;
    };
    portraitTexture?: PortraitTextureSettings;
    durationMs?: number;
    videoTask?: {
        id: string;
        provider: "openai" | "seedance" | "generation";
        model: string;
        pollPath?: string;
        serverTaskId?: string;
        durationSeconds?: number;
    };
    imageTask?: {
        id: string;
        kind: CanvasImageGenerationType;
        model: string;
    };
    textTask?: {
        id: string;
        model: string;
    };
    audioTask?: {
        id: string;
        model: string;
    };
};

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeType;
    title: string;
    position: Position;
    width: number;
    height: number;
    metadata?: CanvasNodeMetadata;
};

export type CanvasConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
    /** Stable port identifiers. Legacy edges omit these and use the default side port. */
    fromHandleId?: string;
    toHandleId?: string;
    /**
     * Vertical attachment point expressed as a proportion of the node height.
     * Connections created before anchor positioning continue to use the centre.
     */
    fromAnchorRatio?: number;
    toAnchorRatio?: number;
};

export type CanvasMediaPerformanceMode = "auto" | "quality" | "performance";

export type CanvasAssistantReference = {
    id: string;
    type: CanvasNodeType;
    title: string;
    dataUrl?: string;
    storageKey?: string;
    text?: string;
};

export type CanvasAssistantImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    remoteUrl?: string;
    serverUrl?: string;
    prompt: string;
};

export type CanvasAssistantMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    references?: CanvasAssistantReference[];
};

export type CanvasAssistantSession = {
    id: string;
    title: string;
    messages: CanvasAssistantMessage[];
    createdAt: string;
    updatedAt: string;
};

export type ConnectionHandle = {
    nodeId: string;
    handleType: "source" | "target";
    /** Optional port identifier for nodes exposing more than one input/output. */
    handleId?: string;
    /** The pointer position within the originating node, clamped to its side handle. */
    anchorRatio?: number;
};

export type SelectionBox = {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    additive: boolean;
    initialSelectedNodeIds: string[];
};

export type ContextMenuState =
    | {
          type: "node";
          x: number;
          y: number;
          nodeId: string;
      }
    | {
          type: "connection";
          x: number;
          y: number;
          connectionId: string;
      };
