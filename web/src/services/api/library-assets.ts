import type { Asset, CreateLibraryAssetInput } from "@/lib/library-asset-contract";

export function listLibraryAssets() {
    return request<{ assets: Asset[] }>("/api/library-assets", { cache: "no-store" }).then((data) => data.assets);
}

export function createLibraryAsset(asset: CreateLibraryAssetInput) {
    return request<{ asset: Asset }>("/api/library-assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(asset) }).then((data) => data.asset);
}

export function saveLibraryAsset(id: string, asset: CreateLibraryAssetInput) {
    return request<{ asset: Asset }>(`/api/library-assets/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(asset) }).then((data) => data.asset);
}

export function deleteLibraryAsset(id: string) {
    return request<{ deleted: boolean }>(`/api/library-assets/${encodeURIComponent(id)}`, { method: "DELETE" });
}

async function request<T>(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const payload = (await response.json().catch(() => ({}))) as { data?: T; msg?: string };
    if (!response.ok || !payload.data) throw new Error(payload.msg || "素材请求失败");
    return payload.data;
}
