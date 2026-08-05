import { execFileSync } from "node:child_process";
import { ProxyAgent, setGlobalDispatcher } from "undici";

let configuredProxy = "";
let windowsProxyCache: string | null | undefined;

export function configureServerProxyDispatcher() {
    const proxy = getOutboundProxyUrl();
    if (!proxy || proxy === configuredProxy) return;
    setGlobalDispatcher(new ProxyAgent(proxy));
    configuredProxy = proxy;
}

export function getOutboundProxyUrl() {
    const env = (globalThis as typeof globalThis & { process: NodeJS.Process }).process.env;
    return env.HTTPS_PROXY || env.HTTP_PROXY || env.ALL_PROXY || env.https_proxy || env.http_proxy || env.all_proxy || env.npm_config_https_proxy || env.npm_config_proxy || readWindowsSystemProxy() || "";
}

function readWindowsSystemProxy() {
    if (process.platform !== "win32") return "";
    if (windowsProxyCache !== undefined) return windowsProxyCache || "";

    try {
        const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
        const enabled = execFileSync("reg", ["query", key, "/v", "ProxyEnable"], { encoding: "utf8", timeout: 1000, windowsHide: true });
        if (!/\sProxyEnable\s+REG_DWORD\s+0x1/i.test(enabled)) {
            windowsProxyCache = null;
            return "";
        }

        const server = execFileSync("reg", ["query", key, "/v", "ProxyServer"], { encoding: "utf8", timeout: 1000, windowsHide: true });
        const match = server.match(/\sProxyServer\s+REG_SZ\s+(.+)\s*$/im);
        windowsProxyCache = normalizeProxyServer(match?.[1] || "");
        return windowsProxyCache || "";
    } catch {
        windowsProxyCache = null;
        return "";
    }
}

function normalizeProxyServer(value: string) {
    const entries = value
        .split(";")
        .map((item) => item.trim())
        .filter(Boolean);
    const preferred = entries.find((item) => /^https=/i.test(item)) || entries.find((item) => /^http=/i.test(item)) || entries[0] || "";
    const proxy = preferred.includes("=") ? preferred.split("=").slice(1).join("=").trim() : preferred;
    if (!proxy || /^socks/i.test(proxy)) return "";
    return /^https?:\/\//i.test(proxy) ? proxy : `http://${proxy}`;
}
