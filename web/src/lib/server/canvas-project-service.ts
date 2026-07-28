import { nanoid } from "nanoid";

import type { CanvasProject, CreateCanvasProjectInput } from "@/lib/canvas-project-contract";
import { createCanvasProject, CanvasProjectStoreError, deleteCanvasProjects, getCanvasProject, listCanvasProjects, listCanvasProjectSummaries, updateCanvasProject } from "@/lib/server/canvas-project-store";
import { collectLocalMediaStorageKeys } from "@/lib/server/local-media-references";
import { deleteUserLocalMediaAssets } from "@/lib/server/local-media-storage";
import { createCreativeConversation, updateCreativeConversation } from "@/lib/server/creative-runtime-store";

const MAX_PROJECT_BYTES = 5 * 1024 * 1024;

export class CanvasProjectServiceError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
    }
}

export function listCanvasProjectsForUser(userId: string) {
    return listCanvasProjectSummaries(userId);
}

export async function getCanvasProjectForUser(userId: string, id: string) {
    const project = await getCanvasProject(text(id, 160), userId);
    if (!project) throw new CanvasProjectServiceError("画布项目不存在", 404);
    return project;
}

export async function createCanvasProjectForUser(userId: string, value: unknown) {
    const input = object(value) as CreateCanvasProjectInput;
    const source = object(input.project);
    const sourceHandoffId = text(input.sourceHandoffId || source.sourceHandoffId, 160);
    if (sourceHandoffId) {
        const existing = (await listCanvasProjects(userId)).find((project) => project.sourceHandoffId === sourceHandoffId);
        if (existing) return existing;
    }
    const id = sourceHandoffId ? `canvas-${sourceHandoffId}` : `canvas-${nanoid()}`;
    const title = text(input.title || source.title, 120) || "未命名画布";
    const now = new Date().toISOString();
    const conversation = await createCreativeConversation(userId, { surface: "canvas", projectId: id, title });
    const project = normalizeProject(source, {
        id,
        sourceHandoffId: sourceHandoffId || undefined,
        creativeConversationId: conversation.id,
        title,
        createdAt: now,
        updatedAt: now,
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
    });
    try {
        return await createCanvasProject(userId, project);
    } catch (error) {
        await updateCreativeConversation(conversation.id, userId, { status: "archived" }).catch(() => null);
        throw error;
    }
}

export async function updateCanvasProjectForUser(userId: string, id: string, value: unknown) {
    const current = await getCanvasProject(text(id, 160), userId);
    if (!current) throw new CanvasProjectServiceError("画布项目不存在", 404);
    const incomingUpdatedAt = parseTimestamp(object(value).updatedAt);
    if (incomingUpdatedAt && incomingUpdatedAt < parseTimestamp(current.updatedAt)) return current;
    const project = normalizeProject(object(value), current);
    return updateCanvasProject(userId, project);
}

export async function deleteCanvasProjectsForUser(userId: string, value: unknown) {
    const ids = Array.isArray(value)
        ? value
              .map((id) => text(id, 160))
              .filter(Boolean)
              .slice(0, 100)
        : [];
    const projects = (await Promise.all(ids.map((id) => getCanvasProject(id, userId)))).filter(Boolean);
    const deleted = await deleteCanvasProjects(userId, ids);
    if (deleted) {
        await Promise.all(projects.map((project) => (project?.creativeConversationId ? updateCreativeConversation(project.creativeConversationId, userId, { status: "archived" }) : Promise.resolve(null))));
    }
    await deleteUserLocalMediaAssets(userId, projects.flatMap(collectLocalMediaStorageKeys));
    return deleted;
}

function normalizeProject(value: Record<string, unknown>, current: CanvasProject): CanvasProject {
    const sanitized = JSON.parse(JSON.stringify(value, (_key, item) => (typeof item === "string" && (item.startsWith("data:") || item.startsWith("blob:")) ? "" : item))) as Record<string, unknown>;
    if (Buffer.byteLength(JSON.stringify(sanitized)) > MAX_PROJECT_BYTES) throw new CanvasProjectServiceError("画布项目数据过大", 413);
    const nodes = Array.isArray(sanitized.nodes) ? sanitized.nodes.slice(0, 2000) : current.nodes;
    const connections = Array.isArray(sanitized.connections) ? sanitized.connections.slice(0, 5000) : current.connections;
    const chatSessions = Array.isArray(sanitized.chatSessions) ? sanitized.chatSessions.slice(0, 100) : current.chatSessions;
    return {
        ...current,
        title: text(sanitized.title, 120) || current.title,
        nodes: nodes as CanvasProject["nodes"],
        connections: connections as CanvasProject["connections"],
        chatSessions: chatSessions as CanvasProject["chatSessions"],
        activeChatId: typeof sanitized.activeChatId === "string" ? sanitized.activeChatId.slice(0, 160) : sanitized.activeChatId === null ? null : current.activeChatId,
        backgroundMode: sanitized.backgroundMode === "dots" || sanitized.backgroundMode === "blank" ? sanitized.backgroundMode : "lines",
        showImageInfo: sanitized.showImageInfo === true,
        viewport: normalizeViewport(sanitized.viewport, current.viewport),
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
        id: current.id,
        sourceHandoffId: current.sourceHandoffId,
        creativeConversationId: current.creativeConversationId,
    };
}

function normalizeViewport(value: unknown, fallback: CanvasProject["viewport"]) {
    const input = object(value);
    const x = Number(input.x);
    const y = Number(input.y);
    const k = Number(input.k);
    return { x: Number.isFinite(x) ? x : fallback.x, y: Number.isFinite(y) ? y : fallback.y, k: Number.isFinite(k) ? Math.max(0.1, Math.min(8, k)) : fallback.k };
}

function object(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, max: number) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseTimestamp(value: unknown) {
    const time = Date.parse(String(value || ""));
    return Number.isFinite(time) ? time : 0;
}

export function canvasProjectError(error: unknown) {
    if (error instanceof CanvasProjectServiceError) return error;
    if (error instanceof CanvasProjectStoreError) return new CanvasProjectServiceError(error.message, error.status);
    return null;
}
