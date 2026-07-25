import { createHash, timingSafeEqual } from "node:crypto";

const MIN_TOKEN_LENGTH = 32;

export function isMaintenanceTokenConfigured() {
    return maintenanceToken().length >= MIN_TOKEN_LENGTH;
}

export function isAuthorizedMaintenanceRequest(request: Request) {
    const configured = maintenanceToken();
    if (configured.length < MIN_TOKEN_LENGTH) return false;

    const authorization = request.headers.get("authorization")?.trim() || "";
    const provided = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
    if (!provided) return false;

    return timingSafeEqual(digest(configured), digest(provided));
}

function maintenanceToken() {
    return process.env.VOZEB_PRO_MAINTENANCE_TOKEN?.trim() || "";
}

function digest(value: string) {
    return createHash("sha256").update(value).digest();
}
