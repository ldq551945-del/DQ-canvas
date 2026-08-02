import { describe, expect, it } from "vitest";

import type { CanvasProject } from "../stores/use-canvas-store";
import { remapImportedProjectMedia } from "./canvas-export";

describe("canvas project import media remapping", () => {
    it("preserves recursive remapping for ordinary canvas media", () => {
        const project = projectFixture({
            nested: [
                {
                    storageKey: "permanent/source/images/reference.png",
                    content: "data:image/png;base64,source",
                    dataUrl: "data:image/png;base64,source",
                    url: "blob:source",
                    remoteUrl: "https://upstream.example/reference.png",
                },
            ],
        });
        const remapped = remapImportedProjectMedia(
            project,
            new Map([
                [
                    "permanent/source/images/reference.png",
                    {
                        storageKey: "permanent/imported/images/reference.png",
                        url: "/api/reference-assets/permanent/imported/images/reference.png",
                    },
                ],
            ]),
        );
        const media = (remapped as unknown as { nested: Array<Record<string, unknown>> }).nested[0];

        expect(media).toEqual({
            storageKey: "permanent/imported/images/reference.png",
            content: "/api/reference-assets/permanent/imported/images/reference.png",
            dataUrl: "/api/reference-assets/permanent/imported/images/reference.png",
            url: "/api/reference-assets/permanent/imported/images/reference.png",
            serverUrl: "/api/reference-assets/permanent/imported/images/reference.png",
        });
        expect((project as unknown as { nested: Array<{ storageKey: string }> }).nested[0].storageKey).toBe("permanent/source/images/reference.png");
    });

    it("updates both tldraw asset storage metadata and src without retaining inline URLs", () => {
        const project = projectFixture({
            drawingDocument: {
                snapshot: {
                    document: {
                        store: {
                            "asset:image-one": tldrawAsset("asset:image-one", "data:image/png;base64,source"),
                            "asset:image-two": tldrawAsset("asset:image-two", "blob:https://example.test/source"),
                        },
                    },
                },
            },
        });
        const uploaded = new Map([
            [
                "permanent/source/images/asset:image-one.png",
                {
                    storageKey: "permanent/imported/images/asset:image-one.png",
                    url: "/api/reference-assets/permanent/imported/images/asset%3Aimage-one.png",
                },
            ],
            [
                "permanent/source/images/asset:image-two.png",
                {
                    storageKey: "permanent/imported/images/asset:image-two.png",
                    url: "/api/reference-assets/permanent/imported/images/asset%3Aimage-two.png",
                },
            ],
        ]);

        const remapped = remapImportedProjectMedia(project, uploaded) as unknown as {
            drawingDocument: { snapshot: { document: { store: Record<string, { props: { src: string }; meta: { storageKey: string } }> } } };
        };
        const store = remapped.drawingDocument.snapshot.document.store;

        expect(store["asset:image-one"]).toMatchObject({
            props: { src: "/api/reference-assets/permanent/imported/images/asset%3Aimage-one.png" },
            meta: { storageKey: "permanent/imported/images/asset:image-one.png" },
        });
        expect(store["asset:image-two"]).toMatchObject({
            props: { src: "/api/reference-assets/permanent/imported/images/asset%3Aimage-two.png" },
            meta: { storageKey: "permanent/imported/images/asset:image-two.png" },
        });
        expect(JSON.stringify(remapped)).not.toMatch(/(?:data|blob):/);
    });
});

function projectFixture(extra: Record<string, unknown>) {
    return {
        id: "project",
        title: "Import fixture",
        createdAt: "2026-08-02T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z",
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "grid",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        ...extra,
    } as unknown as CanvasProject;
}

function tldrawAsset(id: string, src: string) {
    return {
        id,
        typeName: "asset",
        type: "image",
        props: { src, name: `${id}.png`, w: 640, h: 480, mimeType: "image/png", isAnimated: false },
        meta: { storageKey: `permanent/source/images/${id}.png`, bytes: 1024, mimeType: "image/png" },
    };
}
