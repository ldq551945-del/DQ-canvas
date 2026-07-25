import { describe, expect, it } from "vitest";

import type { SystemChannelAdvancedConfig, SystemModelChannel } from "@/lib/auth/store";
import { parseChannelExampleConfig } from "./channel-example-parser";

const advanced: SystemChannelAdvancedConfig = {
    protocol: "auto",
    textModel: "",
    imageModel: "",
    videoModel: "",
    createPath: "",
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
});
