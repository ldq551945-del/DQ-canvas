import { nanoid } from "nanoid";

export function createFreshGenerationTaskContext(scope: string, identifiers: string[], token = nanoid()) {
    const parts = [scope, ...identifiers, token].map((item) => item.trim()).filter(Boolean);
    return {
        attemptNo: 1,
        clientRequestId: parts.join(":"),
    };
}
