import { describe, expect, it } from "vitest";

import { isQingyanProvider } from "./provider-compatibility";

describe("provider compatibility", () => {
    it("prefers the explicit Qingyan protocol", () => {
        expect(isQingyanProvider({ protocol: "qingyan", baseUrl: "/api/ai/system/one" })).toBe(true);
    });

    it("keeps existing Qingyan host and video-v1 configurations working", () => {
        expect(isQingyanProvider({ baseUrl: "https://api2.qingyanzhiying.top/v1" })).toBe(true);
        expect(isQingyanProvider({ baseUrl: "/api/ai/system/one", model: "video-v1" })).toBe(true);
        expect(isQingyanProvider({ baseUrl: "https://api.example.com/v1", model: "video-v2" })).toBe(false);
    });
});
