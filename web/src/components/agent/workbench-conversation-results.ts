import type { WorkbenchAgentMessage } from "./workbench-agent-panel";

export type WorkbenchConversationRecord = {
    id: string;
    creativeConversationId?: string;
    createdAt?: number;
};

export type WorkbenchConversationResult = {
    id: string;
};

export type WorkbenchConversationResultEntry<TRecord, TResult> = {
    key: string;
    recordId: string;
    resultId: string;
    record: TRecord;
    result: TResult;
    resultIndex: number;
    displayIndex: number;
};

export type WorkbenchConversationRecordGroup<TRecord> = {
    record: TRecord;
    records: TRecord[];
};

export function workbenchResultKey(recordId: string, resultId: string) {
    return `${recordId}:${resultId}`;
}

export function workbenchConversationRecords<TRecord extends WorkbenchConversationRecord>(records: TRecord[], activeRecord: TRecord | null) {
    if (!activeRecord) return [];
    const candidates = [activeRecord, ...records.filter((record) => record.id !== activeRecord.id)];
    const conversationRecords = activeRecord.creativeConversationId ? candidates.filter((record) => record.creativeConversationId === activeRecord.creativeConversationId) : [activeRecord];
    return conversationRecords.sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0));
}

export function workbenchConversationRecordGroups<TRecord extends WorkbenchConversationRecord>(records: TRecord[]): WorkbenchConversationRecordGroup<TRecord>[] {
    const groups = new Map<string, WorkbenchConversationRecordGroup<TRecord>>();
    records.forEach((record) => {
        const key = record.creativeConversationId || `record:${record.id}`;
        const group = groups.get(key);
        if (group) group.records.push(record);
        else groups.set(key, { record, records: [record] });
    });
    return [...groups.values()];
}

export function workbenchConversationResultEntries<TRecord extends WorkbenchConversationRecord, TResult extends WorkbenchConversationResult>(records: TRecord[], activeRecord: TRecord | null, resultsFromRecord: (record: TRecord) => TResult[]) {
    let displayIndex = 0;
    return workbenchConversationRecords(records, activeRecord).flatMap((record) =>
        resultsFromRecord(record).map((result, resultIndex): WorkbenchConversationResultEntry<TRecord, TResult> => ({
            key: workbenchResultKey(record.id, result.id),
            recordId: record.id,
            resultId: result.id,
            record,
            result,
            resultIndex,
            displayIndex: displayIndex++,
        })),
    );
}

export function workbenchHistoryMessages(record: { id: string; status: string; error?: string }, publicPrompt: string): WorkbenchAgentMessage[] {
    return [
        ...(publicPrompt ? [{ id: `history-${record.id}-user`, role: "user" as const, text: publicPrompt }] : []),
        {
            id: `history-${record.id}-assistant`,
            role: record.status === "失败" ? "error" : "assistant",
            text: record.status === "失败" ? record.error || "该任务生成失败。" : record.status === "生成中" ? "该任务仍在生成中。" : "已打开这条历史生成记录，可以继续修改或重新生成。",
        },
    ];
}
