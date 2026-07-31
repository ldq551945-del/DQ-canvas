import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const MIN_TOKEN_LENGTH = 32;

export function generationRuntimeEnvironment({ environment = process.env, allowEphemeralToken = false } = {}) {
    const source = { ...environment };
    const configuredToken = source.VOZEB_PRO_MAINTENANCE_TOKEN?.trim() || "";
    if (configuredToken.length < MIN_TOKEN_LENGTH && !allowEphemeralToken) {
        throw new Error("VOZEB_PRO_MAINTENANCE_TOKEN must contain at least 32 characters");
    }

    const port = validPort(source.PORT) || 3000;
    return {
        environment: {
            ...source,
            VOZEB_PRO_MAINTENANCE_TOKEN: configuredToken.length >= MIN_TOKEN_LENGTH ? configuredToken : randomBytes(32).toString("hex"),
            VOZEB_PRO_WORKER_API_ORIGIN: resolveGenerationWorkerOrigin({ environment: source, fallbackOrigin: `http://127.0.0.1:${port}` }),
        },
        ephemeralToken: configuredToken.length < MIN_TOKEN_LENGTH,
    };
}

export function resolveGenerationWorkerOrigin({ environment = process.env, fallbackOrigin = "http://127.0.0.1:3000" } = {}) {
    const raw = environment.VOZEB_PRO_WORKER_API_ORIGIN?.trim() || environment.VOZEB_PRO_INTERNAL_ORIGIN?.trim() || environment.NEXT_PUBLIC_SITE_URL?.trim() || fallbackOrigin;
    const value = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Generation worker origin must use HTTP or HTTPS");
    return url.origin;
}

export function superviseGenerationRuntime({ app, workerScript, environment }) {
    const definitions = [
        { name: "web", command: app.command, args: app.args, cwd: app.cwd },
        { name: "generation-worker", command: process.execPath, args: [workerScript], cwd: app.cwd },
    ];
    const children = definitions.map((definition) => ({
        ...definition,
        process: spawn(definition.command, definition.args, { cwd: definition.cwd, env: environment, stdio: "inherit" }),
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

function validPort(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : undefined;
}
