import type { QueryExecutor } from "@/lib/server/database/postgres";
import type { AnnouncementRecord, GenerationKind, GenerationLogAssetRecord, GenerationLogRecord, GenerationStatus, PageInput, PageResult, PromptRecord, PromptScope } from "./repository-shared";
import { mapAnnouncement, mapGenerationLog, mapGenerationLogAsset, mapPrompt } from "./repository-record-mappers";
import { jsonParam, normalizePage, normalizePageSize, pageResult } from "./repository-shared";

export class AnnouncementsRepository {
    constructor(private readonly db: QueryExecutor) {}

    async list(includeDisabled = false) {
        const result = await this.db.query("SELECT * FROM announcements WHERE ($1::boolean = true OR enabled = true) ORDER BY created_at DESC", [includeDisabled]);
        return result.rows.map(mapAnnouncement);
    }

    async upsert(announcement: AnnouncementRecord) {
        const result = await this.db.query(
            `
            INSERT INTO announcements (id, title, content, enabled, popup_home, popup_after_login, starts_at, ends_at, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (id) DO UPDATE SET
                title = EXCLUDED.title,
                content = EXCLUDED.content,
                enabled = EXCLUDED.enabled,
                popup_home = EXCLUDED.popup_home,
                popup_after_login = EXCLUDED.popup_after_login,
                starts_at = EXCLUDED.starts_at,
                ends_at = EXCLUDED.ends_at
            RETURNING *
            `,
            [
                announcement.id,
                announcement.title,
                announcement.content,
                announcement.enabled,
                announcement.popupHome,
                announcement.popupAfterLogin,
                announcement.startsAt || null,
                announcement.endsAt || null,
                announcement.createdAt,
                announcement.updatedAt,
            ],
        );
        return mapAnnouncement(result.rows[0]);
    }
}

export class PromptsRepository {
    constructor(private readonly db: QueryExecutor) {}

    async list(input: PageInput & { scope: PromptScope; ownerUserId?: string; keyword?: string; category?: string; tags?: string[]; random?: boolean }): Promise<PageResult<PromptRecord>> {
        const page = normalizePage(input.page);
        const pageSize = normalizePageSize(input.pageSize);
        const keyword = input.keyword?.trim().toLowerCase() || "";
        const tags = input.tags?.map((tag) => tag.trim().toLowerCase()).filter(Boolean) || [];
        const result = await this.db.query(
            `
            SELECT *, count(*) OVER() AS total_count
            FROM prompts
            WHERE scope = $1
              AND ($1 = 'library' OR owner_user_id = $2)
              AND ($3 = '' OR lower(title) LIKE $4 OR lower(prompt) LIKE $4 OR lower(category) LIKE $4 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(tags) AS prompt_tag WHERE lower(prompt_tag) LIKE $4))
              AND ($5 = '' OR category = $5)
              AND ($6::text[] IS NULL OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(tags) AS prompt_tag WHERE prompt_tag = ANY($6::text[])))
            ORDER BY ${input.random ? "random()" : "updated_at DESC"}
            LIMIT $7 OFFSET $8
            `,
            [input.scope, input.ownerUserId || null, keyword, `%${keyword}%`, input.category || "", tags.length ? tags : null, pageSize, (page - 1) * pageSize],
        );
        return pageResult(result.rows.map(mapPrompt), Number(result.rows[0]?.total_count || 0), page, pageSize);
    }

    async facets(input: { scope: PromptScope; ownerUserId?: string; keyword?: string; category?: string }) {
        const keyword = input.keyword?.trim().toLowerCase() || "";
        const params = [input.scope, input.ownerUserId || null, keyword, `%${keyword}%`, input.category || ""];
        const [tags, categories, scopeTotal] = await Promise.all([
            this.db.query(
                `
                SELECT DISTINCT prompt_tag AS tag
                FROM prompts
                CROSS JOIN LATERAL jsonb_array_elements_text(prompts.tags) AS prompt_tag
                WHERE scope = $1
                  AND ($1 = 'library' OR owner_user_id = $2)
                  AND ($3 = '' OR lower(title) LIKE $4 OR lower(prompt) LIKE $4 OR lower(category) LIKE $4 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(prompts.tags) AS keyword_tag WHERE lower(keyword_tag) LIKE $4))
                  AND ($5 = '' OR category = $5)
                ORDER BY tag ASC
                `,
                params,
            ),
            this.db.query(
                `
                SELECT DISTINCT category
                FROM prompts
                WHERE scope = $1
                  AND ($1 = 'library' OR owner_user_id = $2)
                ORDER BY category ASC
                `,
                [input.scope, input.ownerUserId || null],
            ),
            this.db.query("SELECT count(*) AS total FROM prompts WHERE scope = $1 AND ($1 = 'library' OR owner_user_id = $2)", [input.scope, input.ownerUserId || null]),
        ]);
        return {
            tags: tags.rows.map((row) => String(row.tag || "")).filter(Boolean),
            categories: categories.rows.map((row) => String(row.category || "")).filter(Boolean),
            scopeTotal: Number(scopeTotal.rows[0]?.total || 0),
        };
    }

    async getById(id: string) {
        const result = await this.db.query("SELECT * FROM prompts WHERE id = $1", [id]);
        return result.rows[0] ? mapPrompt(result.rows[0]) : null;
    }

    async hasSeedSource(source: string) {
        const result = await this.db.query("SELECT 1 FROM prompt_seed_sources WHERE source = $1 LIMIT 1", [source]);
        return Boolean(result.rows[0]);
    }

    async replaceSeededPrompts(sourcePrefix: string, source: string, prompts: PromptRecord[]) {
        await this.db.query("DELETE FROM prompts WHERE source LIKE $1", [`${sourcePrefix}%`]);
        await this.db.query("DELETE FROM prompt_seed_sources WHERE source LIKE $1", [`${sourcePrefix}%`]);
        await this.db.query("INSERT INTO prompt_seed_sources (source) VALUES ($1) ON CONFLICT (source) DO NOTHING", [source]);
        for (const prompt of prompts) await this.upsert(prompt);
    }

    async upsert(prompt: PromptRecord) {
        const result = await this.db.query(
            `
            INSERT INTO prompts (id, scope, owner_user_id, title, cover_url, prompt, tags, category, preview, github_url, source, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (id) DO UPDATE SET
                scope = EXCLUDED.scope,
                owner_user_id = EXCLUDED.owner_user_id,
                title = EXCLUDED.title,
                cover_url = EXCLUDED.cover_url,
                prompt = EXCLUDED.prompt,
                tags = EXCLUDED.tags,
                category = EXCLUDED.category,
                preview = EXCLUDED.preview,
                github_url = EXCLUDED.github_url,
                source = EXCLUDED.source,
                updated_at = EXCLUDED.updated_at
            RETURNING *
            `,
            [prompt.id, prompt.scope, prompt.ownerUserId || null, prompt.title, prompt.coverUrl, prompt.prompt, jsonParam(prompt.tags), prompt.category, prompt.preview, prompt.githubUrl || null, prompt.source || null, prompt.createdAt, prompt.updatedAt],
        );
        return mapPrompt(result.rows[0]);
    }

    async delete(id: string) {
        const result = await this.db.query("DELETE FROM prompts WHERE id = $1", [id]);
        return result.rowCount || 0;
    }
}

export class GenerationLogsRepository {
    constructor(private readonly db: QueryExecutor) {}

    async list(input: PageInput & { userId?: string; kind?: GenerationKind; source?: string; status?: GenerationStatus; keyword?: string; startAt?: string; endAt?: string } = {}): Promise<PageResult<GenerationLogRecord>> {
        const page = normalizePage(input.page);
        const pageSize = normalizePageSize(input.pageSize);
        const keyword = input.keyword?.trim().toLowerCase() || "";
        const result = await this.db.query(
            `
            SELECT *, count(*) OVER() AS total_count
            FROM generation_logs
            WHERE ($1::text IS NULL OR user_id = $1)
              AND ($2::text IS NULL OR kind = $2)
              AND ($3::text IS NULL OR source = $3)
              AND ($4::text IS NULL OR status = $4)
              AND ($5 = '' OR lower(title) LIKE $6 OR lower(prompt) LIKE $6 OR lower(model) LIKE $6 OR lower(username) LIKE $6 OR lower(display_name) LIKE $6 OR lower(summary) LIKE $6)
              AND ($7::timestamptz IS NULL OR created_at >= $7)
              AND ($8::timestamptz IS NULL OR created_at <= $8)
            ORDER BY created_at DESC
            LIMIT $9 OFFSET $10
            `,
            [input.userId || null, input.kind || null, input.source || null, input.status || null, keyword, `%${keyword}%`, input.startAt || null, input.endAt || null, pageSize, (page - 1) * pageSize],
        );
        const logs = await this.attachAssets(result.rows.map(mapGenerationLog));
        return pageResult(logs, Number(result.rows[0]?.total_count || 0), page, pageSize);
    }

    async getById(id: string, forUpdate = false) {
        const result = await this.db.query(`SELECT * FROM generation_logs WHERE id = $1${forUpdate ? " FOR UPDATE" : ""}`, [id]);
        return (await this.attachAssets(result.rows.map(mapGenerationLog)))[0] || null;
    }

    async getByIds(ids: string[], userId?: string, forUpdate = false) {
        if (!ids.length) return [];
        const result = await this.db.query(`SELECT * FROM generation_logs WHERE id = ANY($1::text[]) AND ($2::text IS NULL OR user_id = $2) ORDER BY created_at DESC${forUpdate ? " FOR UPDATE" : ""}`, [ids, userId || null]);
        return this.attachAssets(result.rows.map(mapGenerationLog));
    }

    async listByUserId(userId: string, forUpdate = false) {
        const result = await this.db.query(`SELECT * FROM generation_logs WHERE user_id = $1 ORDER BY created_at DESC${forUpdate ? " FOR UPDATE" : ""}`, [userId]);
        return this.attachAssets(result.rows.map(mapGenerationLog));
    }

    async listByUserAndAssetUrls(userId: string, urls: string[]) {
        if (!urls.length) return [];
        const result = await this.db.query(
            `SELECT DISTINCT gl.* FROM generation_logs gl
             JOIN generation_log_assets asset ON asset.generation_log_id = gl.id
             WHERE gl.user_id = $1 AND COALESCE(NULLIF(asset.server_url, ''), asset.url) = ANY($2::text[])
             ORDER BY gl.created_at DESC`,
            [userId, urls],
        );
        return this.attachAssets(result.rows.map(mapGenerationLog));
    }

    async upsert(log: GenerationLogRecord) {
        const result = await this.db.query(
            `
            INSERT INTO generation_logs (
                id, user_id, conversation_id, username, display_name, kind, source, status, title, prompt, model, summary,
                duration_ms, count, success_count, fail_count, task_id, error, created_at, updated_at, completed_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
            ON CONFLICT (id) DO UPDATE SET
                conversation_id = EXCLUDED.conversation_id,
                username = EXCLUDED.username,
                display_name = EXCLUDED.display_name,
                status = EXCLUDED.status,
                title = EXCLUDED.title,
                prompt = EXCLUDED.prompt,
                model = EXCLUDED.model,
                summary = EXCLUDED.summary,
                duration_ms = EXCLUDED.duration_ms,
                count = EXCLUDED.count,
                success_count = EXCLUDED.success_count,
                fail_count = EXCLUDED.fail_count,
                task_id = EXCLUDED.task_id,
                error = EXCLUDED.error,
                completed_at = EXCLUDED.completed_at
            WHERE generation_logs.user_id = EXCLUDED.user_id
            RETURNING *
            `,
            [
                log.id,
                log.userId,
                log.conversationId || null,
                log.username,
                log.displayName,
                log.kind,
                log.source,
                log.status,
                log.title,
                log.prompt,
                log.model,
                log.summary,
                log.durationMs,
                log.count,
                log.successCount,
                log.failCount,
                log.taskId || null,
                log.error || null,
                log.createdAt,
                log.updatedAt,
                log.completedAt || null,
            ],
        );
        if (!result.rows[0]) throw new Error("generation log id belongs to another user");
        await this.replaceAssets(log.id, log.assets);
        return { ...mapGenerationLog(result.rows[0]), assets: log.assets };
    }

    async delete(ids: string[]) {
        if (!ids.length) return 0;
        const result = await this.db.query("DELETE FROM generation_logs WHERE id = ANY($1::text[])", [ids]);
        return result.rowCount || 0;
    }

    private async attachAssets(logs: GenerationLogRecord[]) {
        if (!logs.length) return logs;
        const result = await this.db.query("SELECT * FROM generation_log_assets WHERE generation_log_id = ANY($1::text[]) ORDER BY sort_order ASC", [logs.map((log) => log.id)]);
        const byLogId = new Map<string, GenerationLogAssetRecord[]>();
        for (const row of result.rows) {
            const list = byLogId.get(row.generation_log_id) || [];
            list.push(mapGenerationLogAsset(row));
            byLogId.set(row.generation_log_id, list);
        }
        return logs.map((log) => ({ ...log, assets: byLogId.get(log.id) || [] }));
    }

    private async replaceAssets(logId: string, assets: GenerationLogAssetRecord[]) {
        await this.db.query("DELETE FROM generation_log_assets WHERE generation_log_id = $1", [logId]);
        for (const [index, asset] of assets.entries()) {
            await this.db.query(
                `
                INSERT INTO generation_log_assets (generation_log_id, type, url, remote_url, server_url, mime_type, width, height, bytes, sort_order)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                `,
                [logId, asset.type, asset.url, asset.remoteUrl || null, asset.serverUrl || null, asset.mimeType || null, asset.width || null, asset.height || null, asset.bytes || null, index],
            );
        }
    }
}
