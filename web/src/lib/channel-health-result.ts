import type { LogicalModelCapability, SystemChannelHealthSnapshot, SystemChannelProtocol } from "@/lib/auth/store";

export type ChannelHealthResult = Omit<SystemChannelHealthSnapshot, "referenceImageTest"> & {
    referenceHint?: string;
    createPath?: string;
    editPath?: string;
    imageToVideoPath?: string;
    queryPath?: string;
    cancelPath?: string;
    cancelMethod?: "POST" | "DELETE";
    requestTemplate?: string;
    resultField?: string;
    statusField?: string;
    durationRange?: string;
    referenceRule?: string;
    supportsReferenceImage?: boolean;
    supportsReferenceVideo?: boolean;
    supportsReferenceAudio?: boolean;
    referenceImageTest?: {
        ok: boolean;
        status: number;
        taskId?: string;
        remoteUrl?: string;
        error?: string;
    };
    pointsCost?: number;
    pointsRemaining?: number;
    taskId?: string;
    remoteUrl?: string;
};

export type ChannelHealthKind = LogicalModelCapability;

export function channelHealthSnapshot(result: ChannelHealthResult, checkedAt = new Date()): SystemChannelHealthSnapshot {
    return {
        ok: result.ok,
        kind: result.kind,
        model: result.model,
        status: result.status,
        checkedAt: checkedAt.toISOString(),
        ...(result.protocolKey ? { protocolKey: result.protocolKey } : {}),
        ...(result.protocol ? { protocol: result.protocol } : {}),
        ...(result.error ? { error: result.error } : {}),
        ...(result.referenceImageTest
            ? {
                  referenceImageTest: {
                      ok: result.referenceImageTest.ok,
                      status: result.referenceImageTest.status,
                      ...(result.referenceImageTest.error ? { error: result.referenceImageTest.error } : {}),
                  },
              }
            : {}),
    };
}
