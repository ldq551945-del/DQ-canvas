import sharp from "sharp";
import { expect, test, type APIRequestContext } from "@playwright/test";

type BackgroundRemovalTask = {
    status?: string;
    error?: string;
    result?: { serverUrl: string; storageKey: string; mimeType: string; width: number; height: number };
};

test.describe("rembg background removal", () => {
    test.skip(!process.env.DQ_E2E_REMBG_URL, "需要隔离 rembg sidecar（设置 DQ_E2E_REMBG_URL）");

    test("persists a transparent result for a Canvas image node", async ({ request }) => {
        const dataUrl = `data:image/png;base64,${(await sourceImage()).toString("base64")}`;
        const uploaded = await request.post("/api/reference-assets", {
            data: { dataUrl, type: "image", persistent: true, purpose: "canvas-image", originalName: "e2e-rembg-source.png" },
        });
        expect(uploaded.ok(), await uploaded.text()).toBe(true);
        const asset = (await uploaded.json()) as { token: string; url: string; mimeType: string };
        expect(asset).toMatchObject({ mimeType: "image/png" });

        const created = await request.post("/api/canvas/projects", {
            data: {
                title: `E2E rembg ${Date.now()}`,
                project: {
                    nodes: [
                        {
                            id: "source",
                            type: "image",
                            title: "抠图源图",
                            position: { x: 0, y: 0 },
                            width: 320,
                            height: 240,
                            metadata: { content: asset.url, storageKey: asset.token, mimeType: "image/png", naturalWidth: 128, naturalHeight: 96, bytes: 512 },
                        },
                    ],
                    connections: [],
                },
            },
        });
        expect(created.ok(), await created.text()).toBe(true);
        const project = ((await created.json()) as { data: { project: { id: string } } }).data.project;
        const body = {
            sourceStorageKey: asset.token,
            options: { version: 3, model: "silueta", preset: "standard", outputMode: "transparent" },
            context: { projectId: project.id, sourceNodeId: "source", clientRequestId: `e2e-rembg:${Date.now()}` },
        };

        const response = await request.post("/api/background-removal-tasks", { data: body });
        expect(response.ok(), await response.text()).toBe(true);
        const task = ((await response.json()) as { data: { task: { id: string; status: string } } }).data.task;
        expect(task.id).toBeTruthy();

        const terminal = await pollBackgroundRemovalTask(request, task.id);
        expect(terminal).toMatchObject({ status: "success", result: { mimeType: "image/png", width: 128, height: 96 } });
        const result = terminal.result!;
        expect(result.storageKey).toMatch(/^permanent\//);
        const output = await request.get(result.serverUrl);
        expect(output.ok(), await output.text()).toBe(true);
        expect(output.headers()["content-type"]).toMatch(/^image\/png/);
        const outputMetadata = await sharp(await output.body()).metadata();
        expect(outputMetadata).toMatchObject({ width: 128, height: 96, hasAlpha: true, channels: 4 });
    });
});

async function pollBackgroundRemovalTask(request: APIRequestContext, id: string, timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    let latest: BackgroundRemovalTask = {};
    while (Date.now() < deadline) {
        const response = await request.get(`/api/background-removal-tasks/${encodeURIComponent(id)}`);
        if (!response.ok()) throw new Error(`background removal task returned ${response.status()}: ${await response.text()}`);
        const payload = (await response.json()) as { data?: { task?: BackgroundRemovalTask } };
        latest = payload.data?.task || {};
        if (["success", "error", "cancelled"].includes(String(latest.status || ""))) return latest;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`background removal task did not reach a terminal state: ${JSON.stringify(latest)}`);
}

function sourceImage() {
    return sharp({ create: { width: 128, height: 96, channels: 3, background: "white" } })
        .composite([{ input: { create: { width: 56, height: 72, channels: 3, background: "black" } }, left: 36, top: 12 }])
        .png()
        .toBuffer();
}
