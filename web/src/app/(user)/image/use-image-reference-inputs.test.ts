import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("image reference upload retry", () => {
    it("retains the original blob only while an upload can still be retried", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/(user)/image/use-image-reference-inputs.tsx"), "utf8");

        expect(source).toContain("retrySourcesRef.current.set(reference.id, { source, name: reference.name })");
        expect(source).toContain("retrySourcesRef.current.delete(reference.id)");
        expect(source).toContain("if (!activeIds.has(id)) retrySourcesRef.current.delete(id)");
        expect(source).toContain("return uploadReference(pending.source");
    });

    it("blocks generation while a reference is uploading or waiting for retry", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/(user)/image/use-image-workbench-controller.tsx"), "utf8");

        expect(source).toContain("references.every((reference) => !reference.uploadStatus)");
    });
});
