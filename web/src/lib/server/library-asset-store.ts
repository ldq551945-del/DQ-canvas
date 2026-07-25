import type { Asset } from "@/lib/library-asset-contract";
import { readJsonDataFile, writeJsonDataFile } from "@/lib/server/data-adapter";
import { ensurePostgresSchema, getDatabaseProvider, postgresQuery } from "@/lib/server/database";

type AssetRecord = { userId: string; asset: Asset };
type AssetDatabase = { version: 1; assets: AssetRecord[] };

const FILE_NAME = "library-assets.json";
let mutationQueue = Promise.resolve();

export async function listLibraryAssets(userId: string) {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<{ asset_json: Asset }>("SELECT asset_json FROM library_assets WHERE user_id = $1 ORDER BY updated_at DESC", [userId]);
        return result.rows.map((row) => row.asset_json);
    }
    return (await readDatabase()).assets
        .filter((record) => record.userId === userId)
        .map((record) => record.asset)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createLibraryAsset(userId: string, asset: Asset) {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        await postgresQuery(`INSERT INTO library_assets (id, user_id, kind, title, asset_json, created_at, updated_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`, [
            asset.id,
            userId,
            asset.kind,
            asset.title,
            JSON.stringify(asset),
            new Date(asset.createdAt),
            new Date(asset.updatedAt),
        ]);
        return asset;
    }
    await mutateDatabase((database) => ({ ...database, assets: [{ userId, asset }, ...database.assets] }));
    return asset;
}

export async function updateLibraryAsset(userId: string, asset: Asset) {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery("UPDATE library_assets SET kind = $3, title = $4, asset_json = $5::jsonb, updated_at = $6 WHERE id = $1 AND user_id = $2 RETURNING id", [
            asset.id,
            userId,
            asset.kind,
            asset.title,
            JSON.stringify(asset),
            new Date(asset.updatedAt),
        ]);
        return result.rows[0] ? asset : null;
    }
    let found = false;
    await mutateDatabase((database) => ({
        ...database,
        assets: database.assets.map((record) => {
            if (record.userId !== userId || record.asset.id !== asset.id) return record;
            found = true;
            return { ...record, asset };
        }),
    }));
    return found ? asset : null;
}

export async function deleteLibraryAsset(userId: string, id: string) {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        return Boolean((await postgresQuery("DELETE FROM library_assets WHERE id = $1 AND user_id = $2 RETURNING id", [id, userId])).rows[0]);
    }
    let deleted = false;
    await mutateDatabase((database) => ({ ...database, assets: database.assets.filter((record) => (record.userId === userId && record.asset.id === id ? ((deleted = true), false) : true)) }));
    return deleted;
}

function readDatabase() {
    return readJsonDataFile<AssetDatabase>(FILE_NAME, { version: 1, assets: [] });
}

function mutateDatabase(mutator: (database: AssetDatabase) => AssetDatabase) {
    const operation = mutationQueue.then(async () => writeJsonDataFile(FILE_NAME, mutator(await readDatabase())));
    mutationQueue = operation.catch(() => undefined);
    return operation;
}
