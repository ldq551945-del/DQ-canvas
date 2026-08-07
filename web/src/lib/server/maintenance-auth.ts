import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const MIN_TOKEN_LENGTH = 32;
const WORKER_USER_HEADER = "x-dq-worker-user-id";
const WORKER_CONTEXT_PREFIX = "dq-worker-v1";

export function isMaintenanceTokenConfigured() {
    return maintenanceToken().length >= MIN_TOKEN_LENGTH;
}

export function isAuthorizedMaintenanceRequest(request: Request) {
    return isAuthorizedBearerRequest(request, maintenanceToken());
}

export function isWorkerTokenConfigured() {
    return configuredWorkerToken().length >= MIN_TOKEN_LENGTH;
}

export function isAuthorizedWorkerRequest(request: Request) {
    return isAuthorizedBearerRequest(request, configuredWorkerToken());
}

export function workerHeaders(userId: string) {
    const token = requiredWorkerToken();
    const normalizedUserId = userId.trim().slice(0, 160);
    if (!normalizedUserId) throw new Error("生成任务 Worker 用户 ID 不能为空");
    return { authorization: `Bearer ${token}`, [WORKER_USER_HEADER]: normalizedUserId };
}

export function authorizedWorkerUserId(request: Request) {
    if (!isAuthorizedWorkerRequest(request)) return "";
    return request.headers.get(WORKER_USER_HEADER)?.trim().slice(0, 160) || "";
}

export function workerContext(userId: string) {
    const token = requiredWorkerToken();
    const normalizedUserId = userId.trim().slice(0, 160);
    if (!normalizedUserId) throw new Error("生成任务 Worker 用户 ID 不能为空");
    const encodedUserId = Buffer.from(normalizedUserId, "utf8").toString("base64url");
    const signature = createHmac("sha256", token).update(`${WORKER_CONTEXT_PREFIX}:${encodedUserId}`).digest("base64url");
    return `${WORKER_CONTEXT_PREFIX}.${encodedUserId}.${signature}`;
}

export function workerContextHeaders(value: string) {
    const [prefix, encodedUserId, signature] = value.split(".");
    const token = configuredWorkerToken();
    if (prefix !== WORKER_CONTEXT_PREFIX || token.length < MIN_TOKEN_LENGTH || !encodedUserId || !signature) return null;
    const expected = createHmac("sha256", token).update(`${WORKER_CONTEXT_PREFIX}:${encodedUserId}`).digest("base64url");
    if (!timingSafeEqual(digest(signature), digest(expected))) return null;
    let userId = "";
    try {
        userId = Buffer.from(encodedUserId, "base64url").toString("utf8").trim().slice(0, 160);
    } catch {
        return null;
    }
    return userId ? workerHeaders(userId) : null;
}

export function requestRuntimeCredential(request: Request, userId: string) {
    const cookie = request.headers.get("cookie")?.trim();
    if (cookie) return cookie;
    const normalizedUserId = userId.trim().slice(0, 160);
    return normalizedUserId && authorizedWorkerUserId(request) === normalizedUserId ? workerContext(normalizedUserId) : "";
}

function isAuthorizedBearerRequest(request: Request, configured: string) {
    if (configured.length < MIN_TOKEN_LENGTH) return false;

    const authorization = request.headers.get("authorization")?.trim() || "";
    const provided = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
    if (!provided) return false;

    return timingSafeEqual(digest(configured), digest(provided));
}

function maintenanceToken() {
    return process.env.DQ_MAINTENANCE_TOKEN?.trim() || "";
}

function configuredWorkerToken() {
    const worker = process.env.DQ_WORKER_TOKEN?.trim() || "";
    const maintenance = maintenanceToken();
    if (worker.length < MIN_TOKEN_LENGTH) return "";
    if (maintenance.length >= MIN_TOKEN_LENGTH && timingSafeEqual(digest(worker), digest(maintenance))) return "";
    return worker;
}

function requiredWorkerToken() {
    const token = configuredWorkerToken();
    if (token.length < MIN_TOKEN_LENGTH) throw new Error("生成任务 Worker 需要配置独立的 DQ_WORKER_TOKEN");
    return token;
}

function digest(value: string) {
    return createHash("sha256").update(value).digest();
}
