import type { CanvasProject } from "@/lib/canvas-project-contract";
import { readJsonDataFile, writeJsonDataFile } from "@/lib/server/data-adapter";
import { ensurePostgresSchema, getDatabaseProvider, postgresQuery } from "@/lib/server/database";

type CanvasProjectRecord = { userId: string; project: CanvasProject };
type CanvasProjectDatabase = { version: 1; projects: CanvasProjectRecord[] };

const FILE_NAME = "canvas-projects.json";
let mutationQueue = Promise.resolve();

export async function listCanvasProjects(userId: string) {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<{ project_json: CanvasProject }>("SELECT project_json FROM canvas_projects WHERE user_id = $1 ORDER BY updated_at DESC", [userId]);
        return result.rows.map((row) => row.project_json);
    }
    return (await readDatabase()).projects
        .filter((record) => record.userId === userId)
        .map((record) => record.project)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getCanvasProject(id: string, userId: string) {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<{ project_json: CanvasProject }>("SELECT project_json FROM canvas_projects WHERE id = $1 AND user_id = $2", [id, userId]);
        return result.rows[0]?.project_json || null;
    }
    return (await readDatabase()).projects.find((record) => record.userId === userId && record.project.id === id)?.project || null;
}

export async function createCanvasProject(userId: string, project: CanvasProject) {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        await postgresQuery(
            `INSERT INTO canvas_projects (id, user_id, title, project_json, created_at, updated_at)
             VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
            [project.id, userId, project.title, JSON.stringify(project), new Date(project.createdAt), new Date(project.updatedAt)],
        );
        return project;
    }
    await mutateDatabase((db) => {
        if (db.projects.some((record) => record.project.id === project.id)) throw new CanvasProjectStoreError("画布项目已存在", 409);
        return { ...db, projects: [{ userId, project }, ...db.projects] };
    });
    return project;
}

export async function updateCanvasProject(userId: string, project: CanvasProject) {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery(
            `UPDATE canvas_projects SET title = $3, project_json = $4::jsonb, updated_at = $5
             WHERE id = $1 AND user_id = $2 RETURNING id`,
            [project.id, userId, project.title, JSON.stringify(project), new Date(project.updatedAt)],
        );
        if (!result.rows[0]) throw new CanvasProjectStoreError("画布项目不存在", 404);
        return project;
    }
    let found = false;
    await mutateDatabase((db) => ({
        ...db,
        projects: db.projects.map((record) => {
            if (record.userId !== userId || record.project.id !== project.id) return record;
            found = true;
            return { ...record, project };
        }),
    }));
    if (!found) throw new CanvasProjectStoreError("画布项目不存在", 404);
    return project;
}

export async function deleteCanvasProjects(userId: string, ids: string[]) {
    const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
    if (!uniqueIds.length) return 0;
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery("DELETE FROM canvas_projects WHERE user_id = $1 AND id = ANY($2::text[]) RETURNING id", [userId, uniqueIds]);
        return result.rows.length;
    }
    let deleted = 0;
    await mutateDatabase((db) => ({
        ...db,
        projects: db.projects.filter((record) => {
            if (record.userId === userId && uniqueIds.includes(record.project.id)) {
                deleted += 1;
                return false;
            }
            return true;
        }),
    }));
    return deleted;
}

function readDatabase() {
    return readJsonDataFile<CanvasProjectDatabase>(FILE_NAME, { version: 1, projects: [] });
}

function mutateDatabase(mutator: (database: CanvasProjectDatabase) => CanvasProjectDatabase) {
    const operation = mutationQueue.then(async () => writeJsonDataFile(FILE_NAME, mutator(await readDatabase())));
    mutationQueue = operation.catch(() => undefined);
    return operation;
}

export class CanvasProjectStoreError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
    }
}
