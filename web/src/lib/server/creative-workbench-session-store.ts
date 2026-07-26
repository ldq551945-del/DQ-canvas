import { ensurePostgresSchema, getDatabaseProvider, postgresQuery } from "@/lib/server/database";
import { dbText, dbTime, mapMessage, readRuntimeFile } from "@/lib/server/creative-runtime-repository";
import type { CreativeWorkbenchSessionDetail, CreativeWorkbenchSessionSummary, WorkbenchWorkspace } from "@/lib/workbench-session-contract";

const MAX_SEARCH_TEXT = 4000;
const DETAIL_PAGE_SIZE = 50;

type SummaryRow = {
    id: unknown;
    title: unknown;
    updated_at: unknown;
    first_prompt: unknown;
    last_prompt: unknown;
    search_text: unknown;
    record_id: unknown;
};

type DetailRow = {
    id: unknown;
    messages: unknown;
    record_id: unknown;
    has_more: unknown;
    next_before_sequence: unknown;
};

export async function listCreativeWorkbenchSessionSummaries(userId: string, workspace: WorkbenchWorkspace, limit: number): Promise<CreativeWorkbenchSessionSummary[]> {
    const size = Math.max(1, Math.min(200, Math.floor(limit)));
    const source = `${workspace}-workbench`;
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<SummaryRow>(
            `WITH scoped_conversations AS (
                 SELECT id, title, updated_at
                 FROM creative_conversations
                 WHERE user_id = $1 AND surface = 'chat' AND source = $2 AND status = 'active'
                 ORDER BY updated_at DESC, id ASC
                 LIMIT $3
             )
             SELECT conversation.id, conversation.title, conversation.updated_at,
                    first_user.content AS first_prompt,
                    last_user.content AS last_prompt,
                    search_content.search_text,
                    linked_asset.record_id
             FROM scoped_conversations AS conversation
             JOIN LATERAL (
                 SELECT content
                 FROM creative_messages
                 WHERE conversation_id = conversation.id AND role = 'user' AND metadata ->> 'workspace' = $4
                 ORDER BY sequence ASC
                 LIMIT 1
             ) AS first_user ON true
             JOIN LATERAL (
                 SELECT content
                 FROM creative_messages
                 WHERE conversation_id = conversation.id AND role = 'user' AND metadata ->> 'workspace' = $4
                 ORDER BY sequence DESC
                 LIMIT 1
             ) AS last_user ON true
             LEFT JOIN LATERAL (
                 SELECT left(string_agg(content, ' ' ORDER BY sequence ASC), $5) AS search_text
                 FROM creative_messages
                 WHERE conversation_id = conversation.id AND metadata ->> 'workspace' = $4
             ) AS search_content ON true
             LEFT JOIN LATERAL (
                 SELECT metadata ->> 'generationLogId' AS record_id
                 FROM creative_assets
                 WHERE conversation_id = conversation.id AND user_id = $1 AND status <> 'deleted' AND metadata ? 'generationLogId'
                 ORDER BY created_at DESC, ordinal DESC
                 LIMIT 1
             ) AS linked_asset ON true
             ORDER BY conversation.updated_at DESC, conversation.id ASC`,
            [userId, source, size, workspace, MAX_SEARCH_TEXT],
        );
        return result.rows.map(mapSummaryRow);
    }

    const db = await readRuntimeFile();
    return db.conversations
        .filter((conversation) => conversation.userId === userId && conversation.surface === "chat" && conversation.source === source && conversation.status === "active")
        .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
        .slice(0, size)
        .flatMap((conversation) => {
            const messages = db.messages.filter((message) => message.conversationId === conversation.id && message.metadata.workspace === workspace).sort((a, b) => a.sequence - b.sequence);
            const userMessages = messages.filter((message) => message.role === "user");
            if (!userMessages.length) return [];
            const recordId = db.assets
                .filter((asset) => asset.conversationId === conversation.id && asset.userId === userId && asset.status !== "deleted" && typeof asset.metadata.generationLogId === "string")
                .sort((a, b) => b.createdAt - a.createdAt || b.ordinal - a.ordinal)[0]?.metadata.generationLogId;
            const firstPrompt = userMessages[0].content;
            return [
                {
                    id: conversation.id,
                    ...(typeof recordId === "string" && recordId ? { recordId } : {}),
                    title: firstPrompt.slice(0, 24) || conversation.title,
                    lastPrompt: userMessages[userMessages.length - 1].content,
                    searchText: messages
                        .map((message) => message.content)
                        .join(" ")
                        .slice(0, MAX_SEARCH_TEXT),
                    updatedAt: conversation.updatedAt,
                },
            ];
        });
}

export async function getCreativeWorkbenchSessionDetail(userId: string, conversationId: string, workspace: WorkbenchWorkspace, beforeSequence = 0): Promise<CreativeWorkbenchSessionDetail | null> {
    const source = `${workspace}-workbench`;
    const cursor = Math.max(0, Math.floor(beforeSequence));
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<DetailRow>(
            `WITH target AS (
                 SELECT id
                 FROM creative_conversations
                 WHERE id = $1 AND user_id = $2 AND surface = 'chat' AND source = $3 AND status = 'active'
             ), recent_messages AS (
                 SELECT message.*
                 FROM creative_messages AS message
                 JOIN target ON target.id = message.conversation_id
                 WHERE message.metadata ->> 'workspace' = $4 AND ($5::int = 0 OR message.sequence < $5)
                 ORDER BY message.sequence DESC
                 LIMIT $6
             ), selected_messages AS (
                 SELECT *
                 FROM recent_messages
                 ORDER BY sequence DESC
                 LIMIT $7
             )
             SELECT target.id,
                    COALESCE((
                        SELECT jsonb_agg(to_jsonb(selected_message) ORDER BY selected_message.sequence ASC)
                        FROM selected_messages AS selected_message
                    ), '[]'::jsonb) AS messages,
                    (SELECT count(*) > $7 FROM recent_messages) AS has_more,
                    (SELECT min(sequence) FROM selected_messages) AS next_before_sequence,
                    (
                        SELECT asset.metadata ->> 'generationLogId'
                        FROM creative_assets AS asset
                        WHERE asset.conversation_id = target.id AND asset.user_id = $2 AND asset.status <> 'deleted' AND asset.metadata ? 'generationLogId'
                        ORDER BY asset.created_at DESC, asset.ordinal DESC
                        LIMIT 1
                    ) AS record_id
             FROM target`,
            [conversationId, userId, source, workspace, cursor, DETAIL_PAGE_SIZE + 1, DETAIL_PAGE_SIZE],
        );
        const row = result.rows[0];
        if (!row) return null;
        const rawMessages = Array.isArray(row.messages) ? row.messages : [];
        return {
            id: dbText(row.id),
            ...optionalRecordId(row.record_id),
            messages: rawMessages.map((message) => mapMessage(message as Record<string, unknown>)),
            hasMore: row.has_more === true,
            ...optionalSequence(row.next_before_sequence),
        };
    }

    const db = await readRuntimeFile();
    const conversation = db.conversations.find((item) => item.id === conversationId && item.userId === userId && item.surface === "chat" && item.source === source && item.status === "active");
    if (!conversation) return null;
    const candidates = db.messages
        .filter((message) => message.conversationId === conversation.id && message.metadata.workspace === workspace)
        .filter((message) => !cursor || message.sequence < cursor)
        .sort((a, b) => b.sequence - a.sequence)
        .slice(0, DETAIL_PAGE_SIZE + 1);
    const messages = candidates.slice(0, DETAIL_PAGE_SIZE).reverse();
    const recordId = db.assets
        .filter((asset) => asset.conversationId === conversation.id && asset.userId === userId && asset.status !== "deleted" && typeof asset.metadata.generationLogId === "string")
        .sort((a, b) => b.createdAt - a.createdAt || b.ordinal - a.ordinal)[0]?.metadata.generationLogId;
    return {
        id: conversation.id,
        ...(typeof recordId === "string" && recordId ? { recordId } : {}),
        messages,
        hasMore: candidates.length > DETAIL_PAGE_SIZE,
        ...(messages[0] ? { nextBeforeSequence: messages[0].sequence } : {}),
    };
}

function mapSummaryRow(row: SummaryRow): CreativeWorkbenchSessionSummary {
    const firstPrompt = dbText(row.first_prompt);
    return {
        id: dbText(row.id),
        ...optionalRecordId(row.record_id),
        title: firstPrompt.slice(0, 24) || dbText(row.title),
        lastPrompt: dbText(row.last_prompt),
        searchText: dbText(row.search_text).slice(0, MAX_SEARCH_TEXT),
        updatedAt: dbTime(row.updated_at),
    };
}

function optionalRecordId(value: unknown) {
    const recordId = dbText(value);
    return recordId ? { recordId } : {};
}

function optionalSequence(value: unknown) {
    const sequence = Math.max(0, Math.floor(Number(value)));
    return sequence ? { nextBeforeSequence: sequence } : {};
}
