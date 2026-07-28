import type { CanvasProject, CanvasProjectSummary, CreateCanvasProjectInput } from "@/lib/canvas-project-contract";

export function listCanvasProjectSummaries() {
    return request<{ projects: CanvasProjectSummary[] }>("/api/canvas/projects", { cache: "no-store" }).then((data) => data.projects);
}

export function getCanvasProject(id: string) {
    return request<{ project: CanvasProject }>(`/api/canvas/projects/${encodeURIComponent(id)}`, { cache: "no-store" }).then((data) => data.project);
}

export function createCanvasProject(input: CreateCanvasProjectInput) {
    return request<{ project: CanvasProject }>("/api/canvas/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }).then((data) => data.project);
}

export function saveCanvasProject(project: CanvasProject) {
    return request<{ project: CanvasProject }>(`/api/canvas/projects/${encodeURIComponent(project.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(project) }).then((data) => data.project);
}

export function deleteCanvasProjects(ids: string[]) {
    return request<{ deleted: number }>("/api/canvas/projects", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
}

async function request<T>(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const payload = (await response.json().catch(() => ({}))) as { data?: T; msg?: string; error?: string };
    if (!response.ok || !payload.data) throw new Error(payload.msg || payload.error || "画布项目请求失败");
    return payload.data;
}
