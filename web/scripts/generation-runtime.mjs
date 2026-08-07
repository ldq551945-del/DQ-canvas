import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const MIN_TOKEN_LENGTH = 32;
const WORKER_ENVIRONMENT_KEYS = [
    "DQ_WORKER_TOKEN",
    "DQ_WORKER_API_ORIGIN",
    "DQ_GENERATION_WORKER_ID",
    "DQ_GENERATION_WORKER_INTERVAL_MS",
    "DQ_GENERATION_WORKER_LANES",
    "DQ_GENERATION_WORKER_HEARTBEAT_MS",
    "DQ_BILLING_REFUND_WORKER_INTERVAL_MS",
    "NODE_ENV",
    "NODE_OPTIONS",
    "NODE_EXTRA_CA_CERTS",
    "TZ",
    "LANG",
    "LC_ALL",
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
];

export function generationRuntimeEnvironment({ environment = process.env, allowEphemeralToken = false } = {}) {
    const source = { ...environment };
    const configuredMaintenanceToken = source.DQ_MAINTENANCE_TOKEN?.trim() || "";
    const configuredWorkerToken = source.DQ_WORKER_TOKEN?.trim() || "";
    if (configuredMaintenanceToken.length < MIN_TOKEN_LENGTH && !allowEphemeralToken) {
        throw new Error("DQ_MAINTENANCE_TOKEN must contain at least 32 characters");
    }
    if (configuredWorkerToken.length < MIN_TOKEN_LENGTH && !allowEphemeralToken) {
        throw new Error("DQ_WORKER_TOKEN must contain at least 32 characters");
    }
    if (configuredMaintenanceToken.length >= MIN_TOKEN_LENGTH && configuredWorkerToken.length >= MIN_TOKEN_LENGTH && configuredMaintenanceToken === configuredWorkerToken) {
        throw new Error("DQ_WORKER_TOKEN must be different from DQ_MAINTENANCE_TOKEN");
    }

    const port = validPort(source.PORT) || 3000;
    const maintenanceToken = configuredMaintenanceToken.length >= MIN_TOKEN_LENGTH ? configuredMaintenanceToken : randomBytes(32).toString("hex");
    let workerToken = configuredWorkerToken.length >= MIN_TOKEN_LENGTH ? configuredWorkerToken : randomBytes(32).toString("hex");
    while (workerToken === maintenanceToken) workerToken = randomBytes(32).toString("hex");
    const workerOrigin = resolveGenerationWorkerOrigin({ environment: source, fallbackOrigin: `http://127.0.0.1:${port}` });
    const appEnvironment = { ...source, DQ_MAINTENANCE_TOKEN: maintenanceToken, DQ_WORKER_TOKEN: workerToken };
    const workerEnvironment = pickWorkerEnvironment({ ...source, DQ_WORKER_TOKEN: workerToken, DQ_WORKER_API_ORIGIN: workerOrigin });
    return {
        appEnvironment,
        workerEnvironment,
        ephemeralToken: configuredMaintenanceToken.length < MIN_TOKEN_LENGTH || configuredWorkerToken.length < MIN_TOKEN_LENGTH,
    };
}

export function resolveGenerationWorkerOrigin({ environment = process.env, fallbackOrigin = "http://127.0.0.1:3000" } = {}) {
    const raw = environment.DQ_WORKER_API_ORIGIN?.trim() || environment.DQ_INTERNAL_ORIGIN?.trim() || environment.NEXT_PUBLIC_SITE_URL?.trim() || fallbackOrigin;
    const value = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Generation worker origin must use HTTP or HTTPS");
    return url.origin;
}

export function superviseGenerationRuntime({ app, workerScript, appEnvironment, workerEnvironment }) {
    const definitions = [
        { name: "web", command: app.command, args: app.args, cwd: app.cwd, environment: appEnvironment },
        { name: "generation-worker", command: process.execPath, args: [workerScript], cwd: app.cwd, environment: workerEnvironment },
    ];
    const children = definitions.map((definition) => ({
        ...definition,
        process: spawn(definition.command, definition.args, { cwd: definition.cwd, env: definition.environment, stdio: "inherit" }),
    }));

    return new Promise((resolve) => {
        let closed = 0;
        let stopping = false;
        let requestedExitCode = 0;
        let forceTimer;

        const cleanup = () => {
            process.off("SIGINT", stopForSignal);
            process.off("SIGTERM", stopForSignal);
            if (forceTimer) clearTimeout(forceTimer);
        };
        const stop = (exitCode) => {
            if (stopping) return;
            stopping = true;
            requestedExitCode = exitCode;
            for (const child of children) {
                if (child.process.exitCode === null && child.process.signalCode === null) child.process.kill("SIGTERM");
            }
            forceTimer = setTimeout(() => {
                for (const child of children) {
                    if (child.process.exitCode === null && child.process.signalCode === null) child.process.kill("SIGKILL");
                }
            }, 5_000);
            forceTimer.unref();
        };
        const stopForSignal = () => stop(0);

        process.once("SIGINT", stopForSignal);
        process.once("SIGTERM", stopForSignal);
        for (const child of children) {
            child.process.once("error", (error) => {
                console.error(`${child.name} process failed to start`, error);
                stop(1);
            });
            child.process.once("close", (code) => {
                closed += 1;
                if (!stopping) {
                    console.error(`${child.name} process stopped unexpectedly with code ${code ?? "unknown"}`);
                    stop(code && code > 0 ? code : 1);
                }
                if (closed === children.length) {
                    cleanup();
                    resolve(requestedExitCode);
                }
            });
        }
    });
}

function pickWorkerEnvironment(environment) {
    return Object.fromEntries(WORKER_ENVIRONMENT_KEYS.filter((key) => environment[key] !== undefined).map((key) => [key, environment[key]]));
}

function validPort(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : undefined;
}
