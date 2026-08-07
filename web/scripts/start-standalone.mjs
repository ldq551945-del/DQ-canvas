import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { generationRuntimeEnvironment, superviseGenerationRuntime } from "./generation-runtime.mjs";
import { prepareStandaloneAssets, validateStandaloneSharpRuntime } from "./standalone-assets.mjs";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const httpObservabilityScript = path.join(webRoot, "scripts", "http-observability.mjs");
const distDir = process.env.NEXT_DIST_DIR?.trim() || ".next";
const buildRoot = path.join(webRoot, distDir);
const standaloneRoot = path.join(buildRoot, "standalone");

const artifacts = await prepareStandaloneAssets({ webRoot, distDir });
validateStandaloneSharpRuntime(artifacts.serverEntry);

const runtime = generationRuntimeEnvironment({
    environment: {
        ...process.env,
        PORT: process.env.PORT || "3000",
        HOSTNAME: process.env.HOSTNAME || "0.0.0.0",
        DQ_DATA_DIR: process.env.DQ_DATA_DIR || path.join(webRoot, ".data"),
        DQ_INTERNAL_ORIGIN: process.env.DQ_INTERNAL_ORIGIN || `http://127.0.0.1:${process.env.PORT || "3000"}`,
    },
});
process.exitCode = await superviseGenerationRuntime({
    app: { command: process.execPath, args: ["--import", pathToFileURL(httpObservabilityScript).href, "server.js"], cwd: standaloneRoot },
    workerScript: path.join(webRoot, "scripts", "generation-worker.mjs"),
    appEnvironment: runtime.appEnvironment,
    workerEnvironment: runtime.workerEnvironment,
});
