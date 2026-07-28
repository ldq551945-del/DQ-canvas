import { describe, expect, it } from "vitest";

import { normalizeWorkbenchAgentAttachments, workbenchAgentAttachmentSignature } from "./workbench-agent-attachment";

describe("workbench Agent attachment contract", () => {
    it("accepts stable permanent media and rejects browser-only or temporary references", () => {
        const attachments = normalizeWorkbenchAgentAttachments([
            { kind: "image", name: "人物", url: "/api/reference-assets/permanent/person.png", storageKey: "permanent/person.png", mimeType: "image/png", width: 1600, height: 900 },
            { kind: "image", name: "本地预览", url: "blob:preview", storageKey: "permanent/local.png", mimeType: "image/png" },
            { kind: "image", name: "临时图", url: "/api/reference-assets/temporary/person.png", storageKey: "temporary/person.png", mimeType: "image/png" },
        ]);

        expect(attachments).toEqual([expect.objectContaining({ storageKey: "permanent/person.png", width: 1600, height: 900 })]);
    });

    it("uses the media identity rather than text to distinguish two turns", () => {
        const first = normalizeWorkbenchAgentAttachments([{ kind: "image", name: "一", url: "/api/reference-assets/permanent/one.png", storageKey: "permanent/one.png", mimeType: "image/png" }]);
        const second = normalizeWorkbenchAgentAttachments([{ kind: "image", name: "二", url: "/api/reference-assets/permanent/two.png", storageKey: "permanent/two.png", mimeType: "image/png" }]);

        expect(workbenchAgentAttachmentSignature(first)).not.toBe(workbenchAgentAttachmentSignature(second));
    });
});
