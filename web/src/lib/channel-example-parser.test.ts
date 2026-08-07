import { describe, expect, it } from "vitest";

import type { SystemChannelAdvancedConfig, SystemModelChannel } from "@/lib/auth/store";
import { parseChannelExampleConfig } from "./channel-example-parser";

const advanced: SystemChannelAdvancedConfig = {
    protocol: "auto",
    textModel: "",
    imageModel: "",
    videoModel: "",
    createPath: "",
    editPath: "",
    imageToVideoPath: "",
    queryPath: "",
    requestTemplate: "",
    resultField: "",
    statusField: "",
    durationRange: "",
    referenceRule: "",
    supportsReferenceImage: false,
    supportsReferenceVideo: false,
    supportsReferenceAudio: false,
};

describe("parseChannelExampleConfig", () => {
    it("recognizes Qingyan as an explicit provider protocol", () => {
        const channel = { id: "one", name: "测试", baseUrl: "", apiKey: "", apiFormat: "openai", models: [], enabled: false } satisfies SystemModelChannel;
        const result = parseChannelExampleConfig('curl https://api2.qingyanzhiying.top/v1/video/generations -d {"model":"video-v1","prompt":"test","duration":5}', channel, advanced);
        expect(result?.patch.advancedConfig?.protocol).toBe("qingyan");
        expect(result?.patch.advancedConfig?.createPath).toBe("/video/generations");
    });

    it("recognizes the VOZEB recommended provider URL", () => {
        const channel = { id: "one", name: "Test", baseUrl: "", apiKey: "", apiFormat: "openai", models: [], enabled: false } satisfies SystemModelChannel;
        const result = parseChannelExampleConfig('curl https://new.aiym.ink/v1/videos/generations -H "Content-Type: application/json" -d {"model":"Seedance 2.0-fast-720p","prompt":"test","duration":5}', channel, advanced);
        expect(result?.patch.advancedConfig?.protocol).toBe("vozeb-recommended");
        expect(result?.patch.advancedConfig?.createPath).toBe("/videos/generations");
    });

    it("stores text-to-image and image-to-image paths independently", () => {
        const channel = { id: "one", name: "测试", baseUrl: "", apiKey: "", apiFormat: "openai", models: [], enabled: false } satisfies SystemModelChannel;
        const generation = parseChannelExampleConfig('curl https://api.example.com/v1/images/generations -d {"model":"image-v1","prompt":"test"}', channel, advanced);
        const edit = parseChannelExampleConfig('curl https://api.example.com/v1/images/edits -d {"model":"image-v1","prompt":"test","image":"https://cdn.example.com/ref.png"}', channel, generation?.patch.advancedConfig || advanced);
        expect(edit?.patch.advancedConfig).toMatchObject({ createPath: "/images/generations", editPath: "/images/edits" });
    });

    it("stores a reference-image video endpoint as the image-to-video path", () => {
        const channel = { id: "one", name: "测试", baseUrl: "", apiKey: "", apiFormat: "openai", models: [], enabled: false } satisfies SystemModelChannel;
        const result = parseChannelExampleConfig('curl https://api.example.com/v1/video/generations -d {"model":"video-v1","prompt":"test","image":"https://cdn.example.com/ref.png"}', channel, advanced);
        expect(result?.patch.advancedConfig).toMatchObject({ imageToVideoPath: "/video/generations", queryPath: "/video/generations/:task_id" });
    });

    it("does not classify attacker-controlled hostnames by substring", () => {
        const channel = { id: "one", name: "Test", baseUrl: "", apiKey: "", apiFormat: "openai", models: [], enabled: false } satisfies SystemModelChannel;
        const sub2Api = parseChannelExampleConfig('curl https://code2alita.com.attacker.test/v1/chat/completions -d {"model":"text-v1","messages":[]}', channel, advanced);
        const globalAiOpc = parseChannelExampleConfig('curl https://globalaiopc.com.attacker.test/v1/chat/completions -d {"model":"text-v1","messages":[]}', channel, advanced);
        expect(sub2Api?.patch.advancedConfig?.protocol).toBe("openai");
        expect(globalAiOpc?.patch.advancedConfig?.protocol).toBe("openai");
    });
});
