import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const actionsSource = readFileSync(new URL("./use-canvas-generation-actions.tsx", import.meta.url), "utf8");
const runtimeSource = readFileSync(new URL("./use-canvas-task-runtime.tsx", import.meta.url), "utf8");

describe("canvas generation hydration failures", () => {
    it("settles initial generation hydration failures and only clears the matching run", () => {
        const flow = functionSource(actionsSource, "const handleGenerateNode", "useEffect(() =>");
        const hydration = requiredIndex(flow, "baseGenerationContext = await hydrateNodeGenerationContext");
        const hydrationCatch = requiredIndex(flow, "} catch (error) {", hydration);
        const nodeError = requiredIndex(flow, "status: NODE_STATUS_ERROR, errorDetails", hydrationCatch);
        const finish = requiredIndex(flow, "if (finishGenerationRequest(nodeId, runController))", nodeError);
        const conditionalClear = requiredIndex(flow, "setRunningNodeId((current) => (current === nodeId ? null : current))", finish);
        const caughtReturn = requiredIndex(flow, "return;", conditionalClear);

        expect(hydration).toBeLessThan(hydrationCatch);
        expect(hydrationCatch).toBeLessThan(nodeError);
        expect(nodeError).toBeLessThan(finish);
        expect(finish).toBeLessThan(conditionalClear);
        expect(flow.slice(hydrationCatch, conditionalClear)).toContain("message.error(errorDetails)");
        expect(conditionalClear).toBeLessThan(caughtReturn);
    });

    it("catches retry hydration failures before starting a request and records the node error", () => {
        const flow = functionSource(actionsSource, "const handleRetryNode", "const generateImageFromTextNode");
        const hydration = requiredIndex(flow, "context = await hydrateNodeGenerationContext");
        const hydrationCatch = requiredIndex(flow, "} catch (error) {", hydration);
        const nodeError = requiredIndex(flow, "status: NODE_STATUS_ERROR, errorDetails", hydrationCatch);
        const caughtReturn = requiredIndex(flow, "return;", nodeError);
        const startRequest = requiredIndex(flow, "const controller = startGenerationRequest", caughtReturn);

        expect(hydration).toBeLessThan(hydrationCatch);
        expect(hydrationCatch).toBeLessThan(nodeError);
        expect(nodeError).toBeLessThan(caughtReturn);
        expect(caughtReturn).toBeLessThan(startRequest);
        expect(flow.slice(hydrationCatch, caughtReturn)).toContain("message.error(errorDetails)");
    });

    it("reports whether request cleanup still owns the active controller", () => {
        const flow = functionSource(runtimeSource, "const finishGenerationRequest", "const stopGenerationByRunningId");

        expect(flow).toContain("if (request?.controller !== controller) return false;");
        expect(flow).toContain("generationRequestsRef.current.delete(targetNodeId);");
        expect(flow).toContain("return true;");
    });

    it("creates a fresh submission identity for each regular video generation", () => {
        const videoFlow = functionSource(actionsSource, 'if (mode === "video")', 'if (mode === "audio")');

        expect(videoFlow).toContain('createFreshGenerationTaskContext("canvas-video", [projectId, videoId])');
        expect(videoFlow).not.toContain("clientRequestId: `canvas-video:");
    });

    it("invalidates node-owned generation requests before late task results can update a node", () => {
        const invalidation = functionSource(runtimeSource, "const invalidateGenerationRequest", "const stopGenerationByRunningId");
        const videoCompletion = functionSource(runtimeSource, "const completeVideoTask", "const completeImageTask");

        expect(invalidation).toContain("request.controller.abort()");
        expect(invalidation).toContain("generationRequestsRef.current.delete(request.targetNodeId)");
        expect(videoCompletion).toContain("assertGenerationRequestActive(nodeId, controller)");
        expect(videoCompletion).toContain("isGenerationRequestActive(nodeId, controller)");
    });
});

function functionSource(source: string, startMarker: string, endMarker: string) {
    const start = requiredIndex(source, startMarker);
    const end = requiredIndex(source, endMarker, start + startMarker.length);
    return source.slice(start, end);
}

function requiredIndex(value: string, marker: string, fromIndex = 0) {
    const index = value.indexOf(marker, fromIndex);
    expect(index, `Missing source marker: ${marker}`).toBeGreaterThanOrEqual(0);
    return index;
}
