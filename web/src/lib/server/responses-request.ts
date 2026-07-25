import { fetchInternalApi } from "@/lib/server/internal-origin";

export const RESPONSES_FALLBACK_TIMEOUT_MS = 12_000;

export async function fetchOptionalResponses(input: string | URL, init: RequestInit = {}) {
    const callerSignal = init.signal || undefined;
    const timeoutSignal = AbortSignal.timeout(RESPONSES_FALLBACK_TIMEOUT_MS);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
    try {
        return await fetchInternalApi(input, { ...init, signal });
    } catch (error) {
        if (callerSignal?.aborted) throw error;
        return null;
    }
}
