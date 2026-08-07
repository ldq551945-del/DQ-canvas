import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/safe-outbound-fetch", () => ({ fetchSafeOutboundUrl: (url: string | URL, init?: RequestInit) => fetch(url, init) }));
vi.mock("@/lib/server/generation-media-authorization", () => ({ generationMediaProxyHeaders: vi.fn(() => ({ "x-dq-media-authorization": "signed" })) }));

const mocks = vi.hoisted(() => ({
    getTask: vi.fn(),
    updateTask: vi.fn(),
    transitionTask: vi.fn(),
    schedule: vi.fn(),
    register: vi.fn(),
    writeMedia: vi.fn(),
    internalFetch: vi.fn(),
}));

vi.mock("@/lib/auth/store", () => ({ getAuthSettings: vi.fn(), refundUserPoints: vi.fn() }));
vi.mock("@/lib/server/audio-task-store", () => ({
    getAudioTask: mocks.getTask,
    updateAudioTask: mocks.updateTask,
    transitionAudioTask: mocks.transitionTask,
}));
vi.mock("@/lib/server/creative-runtime-service", () => ({ registerGenerationTaskAssetsForUser: mocks.register }));
vi.mock("@/lib/server/generation-task-scheduler", () => ({ scheduleGenerationTask: mocks.schedule }));
vi.mock("@/lib/server/reference-asset-store", () => ({ writePersistentMediaDataUrl: mocks.writeMedia }));
vi.mock("@/lib/server/internal-origin", () => ({ fetchInternalApi: mocks.internalFetch, isInternalApiBaseUrl: (baseUrl: string) => baseUrl.startsWith("/") }));

import { createProtocolFixtureServer } from "../../../scripts/protocol-fixture-server.mjs";
import { GenerationSubmissionUncertainError } from "./generation-submission-error";
import { createAudioTaskUpstreamStep, persistAudioTaskResult } from "./audio-task-runtime";
import type { AudioTask } from "./audio-task-store";
import { emptyAdvancedConfig } from "@/lib/channel-protocol-registry";

const WAV_BYTES = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20, 0x10, 0, 0, 0, 1, 0, 1, 0, 0x40, 0x1f, 0, 0, 0x80, 0x3e, 0, 0, 2, 0, 0x10, 0, 0x64, 0x61, 0x74, 0x61, 0, 0, 0, 0]);

describe("audio task runtime submission safety", () => {
    let state: AudioTask;

    beforeEach(() => {
        vi.clearAllMocks();
        state = audioTask();
        mocks.getTask.mockImplementation(async () => state);
        mocks.updateTask.mockImplementation(async (_id: string, patch: Partial<AudioTask>) => {
            state = { ...state, ...patch };
            return state;
        });
        mocks.transitionTask.mockImplementation(async (_task: AudioTask, allowed: string[], patch: Partial<AudioTask>) => {
            if (!allowed.includes(state.status)) return null;
            state = { ...state, ...patch };
            return state;
        });
        mocks.writeMedia.mockResolvedValue({ token: "fixture-audio", url: "/api/reference-assets/fixture-audio.wav" });
        mocks.register.mockResolvedValue(undefined);
        mocks.internalFetch.mockReset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("switches to the next channel after a deterministic 422 rejection", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(Response.json({ error: { message: "参数不受支持" } }, { status: 422 }))
            .mockResolvedValueOnce(Response.json({ audio_url: "https://cdn.example/result.mp3" }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(createAudioTaskUpstreamStep(state, "http://internal")).resolves.toMatchObject({
            state: "result_ready",
            resultUrl: "https://cdn.example/result.mp3",
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(state.config.channelId).toBe("channel-two");
        expect(state.candidateConfigs).toEqual([]);
        expect(state.attempts?.map(({ status }) => status)).toEqual(["failed", "running"]);
        expect(mocks.schedule).toHaveBeenLastCalledWith("audio", "audio-one", expect.objectContaining({ channelId: "channel-two" }));
    });

    it("persists audio bytes returned by a live OpenAI-compatible fixture", async () => {
        const fixture = createProtocolFixtureServer();
        await new Promise<void>((resolve) => fixture.server.listen(0, "127.0.0.1", resolve));
        const address = fixture.server.address();
        if (!address || typeof address === "string") throw new Error("Protocol fixture did not bind a TCP port");
        const origin = `http://127.0.0.1:${address.port}`;
        state = {
            ...audioTask(),
            config: { baseUrl: `${origin}/v1`, apiKey: "fixture-key", apiFormat: "openai", model: "mock-audio", channelId: "fixture-audio", voice: "alloy", format: "wav", speed: "1" },
            candidateConfigs: [],
        };

        try {
            await expect(createAudioTaskUpstreamStep(state, "http://internal")).resolves.toEqual({ state: "completed" });
            expect(state).toMatchObject({ status: "success", result: { url: "/api/reference-assets/fixture-audio.wav", mimeType: "audio/wav" } });
            expect(mocks.writeMedia).toHaveBeenCalledWith(expect.stringMatching(/^data:audio\/wav;base64,UklGR/), "audio", expect.objectContaining({ ownerUserId: "user-one", taskId: "audio-one" }));
            expect(mocks.register).toHaveBeenCalledOnce();
            expect(fixture.requests[0]).toMatchObject({ method: "POST", path: "/v1/audio/speech" });
            expect(fixture.requests[0]?.headers.authorization).toBe("Bearer fixture-key");
            expect(fixture.requests[0]?.headers["idempotency-key"]).toBe("audio-task:audio-one:attempt:1");
            expect(fixture.requests[0]?.headers["x-client-request-id"]).toBe("audio-task:audio-one:attempt:1");
        } finally {
            await new Promise<void>((resolve, reject) => fixture.server.close((error) => (error ? reject(error) : resolve())));
        }
    });

    it("uses the exact custom audio template and configured result field", async () => {
        const fixture = createProtocolFixtureServer();
        await new Promise<void>((resolve) => fixture.server.listen(0, "127.0.0.1", resolve));
        const address = fixture.server.address();
        if (!address || typeof address === "string") throw new Error("Protocol fixture did not bind a TCP port");
        const origin = "http://127.0.0.1:" + address.port;
        state = {
            ...audioTask(),
            config: {
                baseUrl: origin,
                apiKey: "fixture-key",
                apiFormat: "openai",
                model: "custom-audio",
                channelId: "fixture-custom-audio",
                voice: "nova",
                format: "wav",
                speed: "1.25",
                advancedConfig: {
                    ...emptyAdvancedConfig(),
                    protocol: "custom",
                    createPath: "/custom/audio",
                    requestTemplate: '{"deployment":"{{model}}","content":"{{input}}","speaker":"{{voice}}","rate":"{{speed}}"}',
                    resultField: "data.audio_url",
                },
            },
            candidateConfigs: [],
        };

        try {
            await expect(createAudioTaskUpstreamStep(state, "")).resolves.toMatchObject({ state: "result_ready", resultUrl: expect.stringContaining("/media/fixture.wav") });
            expect(fixture.requests).toHaveLength(1);
            expect(fixture.requests[0]?.path).toBe("/custom/audio");
            expect(fixture.requests[0]?.headers.authorization).toBe("Bearer fixture-key");
            expect(fixture.requests[0]?.headers["idempotency-key"]).toBe("audio-task:audio-one:attempt:1");
            expect(JSON.parse(fixture.requests[0]?.body.toString("utf8") || "{}")).toEqual({ deployment: "custom-audio", content: "test", speaker: "nova", rate: 1.25 });
        } finally {
            await new Promise<void>((resolve, reject) => fixture.server.close((error) => (error ? reject(error) : resolve())));
        }
    });

    it("keeps the original candidate when the request connection is interrupted", async () => {
        const fetchMock = vi.fn().mockRejectedValueOnce(new Error("socket closed"));
        vi.stubGlobal("fetch", fetchMock);

        await expect(createAudioTaskUpstreamStep(state, "http://internal")).rejects.toBeInstanceOf(GenerationSubmissionUncertainError);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(state.config.channelId).toBe("channel-one");
        expect(state.candidateConfigs).toHaveLength(1);
        expect(state.attempts?.map(({ status }) => status)).toEqual(["running"]);
    });

    it("treats a successful response with invalid JSON as an uncertain submission", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("not-json", { status: 200, headers: { "content-type": "application/json" } })));

        await expect(createAudioTaskUpstreamStep(state, "http://internal")).rejects.toBeInstanceOf(GenerationSubmissionUncertainError);
        expect(state.config.channelId).toBe("channel-one");
    });

    it("adds model identity and a task-bound capability when downloading proxied audio", async () => {
        state = audioTask();
        state.status = "running";
        state.config = { ...state.config, baseUrl: "/api/ai/system/channel-one", channelId: "channel-one", logicalModel: "audio-logical" };
        mocks.internalFetch.mockResolvedValue(new Response(WAV_BYTES, { headers: { "content-type": "audio/mpeg" } }));

        await persistAudioTaskResult(state, "http://internal", "https://cdn.example.com/result.mp3");

        const [, init] = mocks.internalFetch.mock.calls[0] || [];
        const headers = new Headers(init?.headers);
        expect(headers.get("x-dq-logical-model")).toBe("audio-logical");
        expect(headers.get("x-dq-upstream-model")).toBe("audio-one");
        expect(headers.get("x-dq-media-authorization")).toBe("signed");
    });

    it("rejects executable bytes that forge an audio response type", async () => {
        state = { ...audioTask(), status: "running" };
        state.config = { ...state.config, baseUrl: "/api/ai/system/channel-one", channelId: "channel-one" };
        mocks.internalFetch.mockResolvedValue(new Response("<html><script>alert(1)</script></html>", { headers: { "content-type": "audio/mpeg" } }));

        await expect(persistAudioTaskResult(state, "http://internal", "/api/audio/result")).rejects.toThrow("Unsupported media content");
        expect(mocks.writeMedia).not.toHaveBeenCalled();
        expect(state.status).toBe("running");
    });

    it("rejects oversized audio responses before buffering their body", async () => {
        state = { ...audioTask(), status: "running" };
        state.config = { ...state.config, baseUrl: "/api/ai/system/channel-one", channelId: "channel-one" };
        const cancel = vi.fn();
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(WAV_BYTES);
            },
            cancel,
        });
        mocks.internalFetch.mockResolvedValue(new Response(body, { headers: { "content-type": "audio/wav", "content-length": String(30 * 1024 * 1024 + 1) } }));

        await expect(persistAudioTaskResult(state, "http://internal", "/api/audio/result")).rejects.toThrow("超过 30MB");
        expect(cancel).toHaveBeenCalled();
        expect(mocks.writeMedia).not.toHaveBeenCalled();
    });
});

function audioTask(): AudioTask {
    const second = { baseUrl: "https://two.example", apiKey: "two", apiFormat: "openai" as const, model: "audio-two", channelId: "channel-two", voice: "alloy", format: "mp3", speed: "1" };
    return {
        id: "audio-one",
        userId: "user-one",
        status: "pending",
        createdAt: 1,
        updatedAt: 1,
        config: { baseUrl: "https://one.example", apiKey: "one", apiFormat: "openai", model: "audio-one", channelId: "channel-one", voice: "alloy", format: "mp3", speed: "1" },
        candidateConfigs: [second],
        prompt: "test",
    };
}
