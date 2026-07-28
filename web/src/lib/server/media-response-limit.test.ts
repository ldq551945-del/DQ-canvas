import { describe, expect, it } from "vitest";

import { MAX_MEDIA_PROXY_RANGE_BYTES, normalizeMediaProxyRange } from "./media-response-limit";

describe("normalizeMediaProxyRange", () => {
    it("keeps normal single ranges and bounds open or oversized ranges", () => {
        expect(normalizeMediaProxyRange("bytes=2-5")).toBe("bytes=2-5");
        expect(normalizeMediaProxyRange("bytes=100-")).toBe(`bytes=100-${100 + MAX_MEDIA_PROXY_RANGE_BYTES - 1}`);
        expect(normalizeMediaProxyRange("bytes=0-999999999")).toBe(`bytes=0-${MAX_MEDIA_PROXY_RANGE_BYTES - 1}`);
        expect(normalizeMediaProxyRange("bytes=-999999999")).toBe(`bytes=-${MAX_MEDIA_PROXY_RANGE_BYTES}`);
    });

    it("rejects multiple, empty, reversed and unsafe ranges", () => {
        expect(normalizeMediaProxyRange("bytes=0-1,4-5")).toBe("invalid");
        expect(normalizeMediaProxyRange("bytes=-")).toBe("invalid");
        expect(normalizeMediaProxyRange("bytes=5-2")).toBe("invalid");
        expect(normalizeMediaProxyRange("bytes=999999999999999999999-")).toBe("invalid");
    });
});
