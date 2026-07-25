import type { SystemChannelProtocol } from "@/lib/auth/store";

export function isQingyanProvider(input: { baseUrl?: string; model?: string; protocol?: SystemChannelProtocol }) {
    if (input.protocol === "qingyan") return true;
    if (input.model?.trim().toLowerCase() === "video-v1") return true;
    try {
        return new URL(input.baseUrl || "", "http://localhost").hostname.toLowerCase() === "api2.qingyanzhiying.top";
    } catch {
        return false;
    }
}
