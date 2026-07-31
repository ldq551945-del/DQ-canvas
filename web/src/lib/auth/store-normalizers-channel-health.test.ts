import { describe, expect, it } from "vitest";

import type { LogicalModelCapability, SystemChannelHealthSnapshot } from "./store-types";
import { normalizeSystemChannel } from "./store-normalizers";

describe("system channel health normalization", () => {
    it("keeps the reload status while dropping transient upstream data", () => {
        const unsafeHealthResults = {
            image: {
                ok: true,
                kind: "image",
                model: "image-model",
                status: 200,
                checkedAt: "2026-08-01T00:00:00.000Z",
                protocolKey: "openai",
                protocol: "OpenAI 图片",
                taskId: "temporary-task",
                remoteUrl: "https://cdn.example.com/private.png",
                pointsCost: 2,
                referenceImageTest: { ok: true, status: 200, taskId: "edit-task", remoteUrl: "https://cdn.example.com/edit.png" },
            },
        } as unknown as Partial<Record<LogicalModelCapability, SystemChannelHealthSnapshot>>;
        const channel = normalizeSystemChannel({
            id: "channel",
            healthResults: unsafeHealthResults,
        });

        expect(channel.healthResults?.image).toEqual({
            ok: true,
            kind: "image",
            model: "image-model",
            status: 200,
            checkedAt: "2026-08-01T00:00:00.000Z",
            protocolKey: "openai",
            protocol: "OpenAI 图片",
            referenceImageTest: { ok: true, status: 200 },
        });
    });
});
