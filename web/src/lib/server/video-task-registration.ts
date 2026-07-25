export type RegisteredVideoUpstreamInput = {
    id?: string;
    provider?: string;
    model?: string;
    pollPath?: string;
    resultUrl?: string;
    pointsCost?: number;
    pointsUnits?: number;
};

export function sanitizeRegisteredVideoUpstream(value?: RegisteredVideoUpstreamInput): { id: string; provider: "openai" | "seedance" | "generation"; model: string; pollPath?: string; resultUrl?: string } | null {
    const id = value?.id?.trim() || "";
    const model = value?.model?.trim() || "";
    const provider = value?.provider;
    if (!id || !model || (provider !== "openai" && provider !== "seedance" && provider !== "generation")) return null;
    return { id, model, provider, pollPath: value?.pollPath?.trim() || undefined, resultUrl: value?.resultUrl?.trim() || undefined };
}

export function canTransitionVideoTask(current: string, next: string) {
    return current === "running" && ["success", "error", "cancelled"].includes(next);
}
