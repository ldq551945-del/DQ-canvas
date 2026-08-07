import { pathToFileURL } from "node:url";

const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_PAGE_PATHS = ["/", "/login", "/register", "/gallery"];
const STATIC_ASSETS = [
    { path: "/logo.svg", contentType: "image/svg+xml" },
    { path: "/icon.svg", contentType: "image/svg+xml" },
    { path: "/favicon.ico", contentType: "image/" },
];
const SESSION_KEYS = new Set(["user", "settings", "install"]);
const PUBLIC_SETTINGS_KEYS = new Set(["site", "registrationEnabled", "emailRegistrationEnabled", "modelPointCosts", "generationPointMultipliers", "generationConcurrency", "generationDefaults", "defaultModels", "logicalModels", "systemChannels"]);
const PUBLIC_CHANNEL_KEYS = new Set(["id", "name", "baseUrl", "apiKey", "apiFormat", "models", "enabled", "hasApiKey"]);
const FORBIDDEN_PUBLIC_KEYS = new Set([
    "advancedConfig",
    "agentSkills",
    "allowUserApiConfig",
    "authHeader",
    "authMode",
    "authPrefix",
    "cancelPath",
    "createPath",
    "editPath",
    "entitlements",
    "healthResults",
    "mail",
    "modelCatalogPaths",
    "modelConfigs",
    "operationConfigs",
    "protocol",
    "queryPath",
    "requestTemplate",
    "responseTemplate",
    "webhookSecret",
]);

export function parseDeploymentSmokeArgs(argv, env = process.env) {
    const options = {
        baseUrl: env.DQ_DEPLOYMENT_BASE_URL || env.DEPLOYMENT_BASE_URL || DEFAULT_BASE_URL,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        pagePaths: [...DEFAULT_PAGE_PATHS],
        json: false,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "--") continue;
        if (argument === "--base-url") options.baseUrl = requireArgument(argv, ++index, argument);
        else if (argument === "--timeout-ms") options.timeoutMs = positiveInteger(requireArgument(argv, ++index, argument), argument);
        else if (argument === "--path") options.pagePaths.push(normalizePagePath(requireArgument(argv, ++index, argument)));
        else if (argument === "--json") options.json = true;
        else if (argument === "--help" || argument === "-h") options.help = true;
        else throw new Error(`Unknown argument: ${argument}`);
    }

    options.baseUrl = normalizeBaseUrl(options.baseUrl);
    options.pagePaths = [...new Set(options.pagePaths)];
    return options;
}

export async function runDeploymentSmoke(options = {}) {
    const baseUrl = normalizeBaseUrl(options.baseUrl || DEFAULT_BASE_URL);
    const timeoutMs = positiveInteger(options.timeoutMs || DEFAULT_TIMEOUT_MS, "timeoutMs");
    const pagePaths = [...new Set(options.pagePaths || DEFAULT_PAGE_PATHS)].map(normalizePagePath);
    const fetchImpl = options.fetchImpl || fetch;
    const results = [];

    const live = await checkJsonEndpoint({ baseUrl, path: "/api/health/live", label: "liveness", timeoutMs, fetchImpl, results });
    assert(live.code === 0 && live.data?.status === "live", "Liveness payload is invalid");

    const ready = await checkJsonEndpoint({ baseUrl, path: "/api/health/ready", label: "readiness", timeoutMs, fetchImpl, results });
    validateReadinessPayload(ready);

    const session = await checkJsonEndpoint({ baseUrl, path: "/api/auth/session", label: "public session", timeoutMs, fetchImpl, results });
    validatePublicSessionPayload(session);

    for (const asset of STATIC_ASSETS) {
        await checkContentEndpoint({ baseUrl, path: asset.path, label: `asset ${asset.path}`, expectedContentType: asset.contentType, timeoutMs, fetchImpl, results });
    }
    for (const pagePath of pagePaths) {
        await checkContentEndpoint({ baseUrl, path: pagePath, label: `page ${pagePath}`, expectedContentType: "text/html", timeoutMs, fetchImpl, results });
    }

    return { baseUrl, checkedAt: new Date().toISOString(), results };
}

export function validateReadinessPayload(payload) {
    assert(isRecord(payload), "Readiness response must be a JSON object");
    assert(payload.code === 0, "Readiness code is not zero");
    assert(payload.data?.ready === true, "Application is not ready");
    assert(payload.data?.database?.healthy === true, "Database is not healthy");
    assert(payload.data?.database?.schemaReady === true, "Database schema is not ready");
    assert(payload.data?.encryptionReady === true, "Encryption configuration is not ready");
    assert(payload.data?.firstAdminRequired === false, "First administrator setup is incomplete");
    assert(payload.data?.generationWorker?.required === true, "Generation worker readiness is not enforced");
    assert(payload.data?.generationWorker?.healthy === true, "Generation worker heartbeat is unhealthy");
}

export function validatePublicSessionPayload(payload) {
    assert(isRecord(payload), "Public session response must be a JSON object");
    assertOnlyKeys(payload, SESSION_KEYS, "session");
    assert(payload.user === null || isRecord(payload.user), "Session user must be an object or null");
    assert(isRecord(payload.settings), "Session settings must be an object");
    assert(isRecord(payload.install), "Session install status must be an object");
    assertOnlyKeys(payload.settings, PUBLIC_SETTINGS_KEYS, "session.settings");
    assertNoForbiddenKeys(payload, "session");

    const channels = payload.settings.systemChannels;
    if (channels !== undefined) {
        assert(Array.isArray(channels), "session.settings.systemChannels must be an array");
        channels.forEach((channel, index) => {
            assert(isRecord(channel), `session.settings.systemChannels[${index}] must be an object`);
            assertOnlyKeys(channel, PUBLIC_CHANNEL_KEYS, `session.settings.systemChannels[${index}]`);
            assert(typeof channel.baseUrl === "string" && channel.baseUrl.startsWith("/api/ai/system/"), `session.settings.systemChannels[${index}].baseUrl exposes an upstream address`);
            assert(channel.apiKey === "system", `session.settings.systemChannels[${index}].apiKey is not the public sentinel`);
        });
    }
}

async function checkJsonEndpoint(input) {
    const response = await request(input);
    assert(response.ok, `${input.label} returned HTTP ${response.status}`);
    assertSameOrigin(input.baseUrl, response.url, input.label);
    assertContentType(response, "application/json", input.label);
    assertRequestId(response, input.label);
    const body = await response.json().catch(() => fail(`${input.label} returned invalid JSON`));
    input.results.push(result(input.label, input.path, response));
    return body;
}

async function checkContentEndpoint(input) {
    const response = await request(input);
    assert(response.ok, `${input.label} returned HTTP ${response.status}`);
    assertSameOrigin(input.baseUrl, response.url, input.label);
    assertContentType(response, input.expectedContentType, input.label);
    const body = await response.arrayBuffer();
    assert(body.byteLength > 0, `${input.label} returned an empty body`);
    input.results.push(result(input.label, input.path, response, body.byteLength));
}

async function request({ baseUrl, path, label, timeoutMs, fetchImpl }) {
    const url = new URL(path.slice(1), `${baseUrl}/`).toString();
    try {
        return await fetchImpl(url, {
            method: "GET",
            redirect: "follow",
            headers: { accept: path.startsWith("/api/") ? "application/json" : "*/*", "user-agent": "DQ-Deployment-Smoke/1.0" },
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch (error) {
        throw new Error(`${label} request failed: ${safeErrorMessage(error)}`);
    }
}

function assertRequestId(response, label) {
    const requestId = response.headers.get("x-request-id") || "";
    assert(/^[A-Za-z0-9._:-]{1,160}$/.test(requestId), `${label} response is missing a valid x-request-id header`);
}

function assertContentType(response, expected, label) {
    const contentType = response.headers.get("content-type") || "";
    assert(contentType.toLowerCase().startsWith(expected), `${label} returned unexpected content type: ${contentType || "missing"}`);
}

function assertSameOrigin(baseUrl, responseUrl, label) {
    if (!responseUrl) return;
    assert(new URL(responseUrl).origin === new URL(baseUrl).origin, `${label} redirected to another origin`);
}

function assertOnlyKeys(value, allowed, path) {
    for (const key of Object.keys(value)) assert(allowed.has(key), `${path}.${key} is not in the public allowlist`);
}

function assertNoForbiddenKeys(value, path) {
    if (Array.isArray(value)) {
        value.forEach((item, index) => assertNoForbiddenKeys(item, `${path}[${index}]`));
        return;
    }
    if (!isRecord(value)) return;
    for (const [key, nested] of Object.entries(value)) {
        assert(!FORBIDDEN_PUBLIC_KEYS.has(key), `${path}.${key} exposes internal configuration`);
        assertNoForbiddenKeys(nested, `${path}.${key}`);
    }
}

function normalizeBaseUrl(value) {
    const url = new URL(String(value).trim());
    assert(url.protocol === "http:" || url.protocol === "https:", "Deployment base URL must use HTTP or HTTPS");
    assert(!url.username && !url.password, "Deployment base URL must not contain credentials");
    assert(!url.search && !url.hash, "Deployment base URL must not contain a query string or fragment");
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
}

function normalizePagePath(value) {
    const path = String(value).trim();
    assert(path.startsWith("/") && !path.startsWith("//"), `Page path must start with one slash: ${path}`);
    assert(!path.includes("?") && !path.includes("#"), `Page path must not contain a query string or fragment: ${path}`);
    return path;
}

function positiveInteger(value, label) {
    const parsed = Number(value);
    assert(Number.isSafeInteger(parsed) && parsed > 0, `${label} must be a positive integer`);
    return parsed;
}

function requireArgument(argv, index, flag) {
    const value = argv[index];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    return value;
}

function result(label, path, response, bytes) {
    return { label, path, status: response.status, ...(bytes === undefined ? {} : { bytes }) };
}

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeErrorMessage(error) {
    if (error instanceof Error && error.name === "TimeoutError") return "timed out";
    return error instanceof Error ? error.message : String(error);
}

function assert(condition, message) {
    if (!condition) fail(message);
}

function fail(message) {
    throw new Error(message);
}

function printHelp() {
    console.log(`Usage: pnpm run smoke:deployment -- [options]

Options:
  --base-url <url>    Deployment root (default: DQ_DEPLOYMENT_BASE_URL or http://127.0.0.1:3000)
  --timeout-ms <ms>   Per-request timeout (default: 10000)
  --path <path>       Add a same-origin HTML page check; may be repeated
  --json              Print machine-readable JSON
  --help              Show this help`);
}

async function main() {
    try {
        const options = parseDeploymentSmokeArgs(process.argv.slice(2));
        if (options.help) return printHelp();
        const report = await runDeploymentSmoke(options);
        if (options.json) console.log(JSON.stringify(report, null, 2));
        else {
            for (const item of report.results) console.log(`PASS ${item.status} ${item.path}${item.bytes === undefined ? "" : ` (${item.bytes} bytes)`}`);
            console.log(`Deployment smoke passed: ${report.results.length} checks against ${report.baseUrl}`);
        }
    } catch (error) {
        console.error(`Deployment smoke failed: ${safeErrorMessage(error)}`);
        process.exitCode = 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
