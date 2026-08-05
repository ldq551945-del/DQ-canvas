/// <reference lib="webworker" />

import { FaceDetector } from "@mediapipe/tasks-vision";

import type { CanvasFaceBox } from "./canvas-emotion";
import { suppressKnownMediaPipeDiagnostics } from "./canvas-face-detector-console";

suppressKnownMediaPipeDiagnostics();

type DetectFaceRequest = {
    id: number;
    image: ImageBitmap;
};

type DetectFaceResponse = {
    id: number;
    faces?: CanvasFaceBox[];
    imageWidth?: number;
    imageHeight?: number;
    error?: string;
};

let detectorPromise: Promise<FaceDetector> | null = null;

const workerGlobal = self as typeof self & {
    importScripts: (...urls: string[]) => void;
    import?: (url: string) => Promise<unknown>;
};

// MediaPipe falls back from importScripts to self.import inside module workers.
workerGlobal.importScripts = () => {
    throw new TypeError("module worker uses dynamic import");
};
workerGlobal.import = async (url: string) => {
    return import(/* webpackIgnore: true */ url.replace(/\?import(?:&.*)?$/, ""));
};

function getDetector() {
    if (!detectorPromise) {
        detectorPromise = FaceDetector.createFromOptions(
            {
                wasmLoaderPath: "/mediapipe/wasm/vision_wasm_module_internal.js",
                wasmBinaryPath: "/mediapipe/wasm/vision_wasm_module_internal.wasm",
            },
            {
                baseOptions: { modelAssetPath: "/canvas/models/blaze-face-full-range-sparse.tflite" },
                runningMode: "IMAGE",
                minDetectionConfidence: 0.25,
                minSuppressionThreshold: 0.3,
            },
        );
    }
    return detectorPromise;
}

self.onmessage = async (event: MessageEvent<DetectFaceRequest>) => {
    const { id, image } = event.data;
    const response: DetectFaceResponse = { id, imageWidth: image.width, imageHeight: image.height };
    try {
        const detector = await getDetector();
        response.faces = detector.detect(image).detections.flatMap((detection, index) => {
            const box = detection.boundingBox;
            if (!box) return [];
            return [
                {
                    id: `face-${id}-${index}`,
                    x: box.originX,
                    y: box.originY,
                    width: box.width,
                    height: box.height,
                    confidence: detection.categories[0]?.score,
                    source: "detected" as const,
                },
            ];
        });
    } catch (error) {
        response.error = error instanceof Error ? error.message : "人脸识别失败";
        detectorPromise = null;
    } finally {
        image.close();
    }
    self.postMessage(response);
};

export {};
