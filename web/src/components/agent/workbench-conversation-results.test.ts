import { describe, expect, it } from "vitest";

import { workbenchConversationRecordGroups, workbenchConversationResultEntries, workbenchConversationRecords, workbenchHistoryMessages } from "./workbench-conversation-results";

describe("workbench conversation results", () => {
    const records = [
        { id: "new", creativeConversationId: "conversation", createdAt: 20, results: [{ id: "new-result" }] },
        { id: "old", creativeConversationId: "conversation", createdAt: 10, results: [{ id: "old-result" }] },
        { id: "other", creativeConversationId: "other-conversation", createdAt: 5, results: [{ id: "other-result" }] },
    ];

    it("keeps every generation round in the active conversation and displays older results first", () => {
        const entries = workbenchConversationResultEntries(records, records[0], (record) => record.results);

        expect(entries.map((entry) => [entry.recordId, entry.resultId, entry.displayIndex])).toEqual([
            ["old", "old-result", 0],
            ["new", "new-result", 1],
        ]);
    });

    it("includes a newly-created active record before it appears in the hydrated list", () => {
        const pending = { id: "pending", creativeConversationId: "conversation", createdAt: 30, results: [{ id: "pending-result" }] };

        expect(workbenchConversationResultEntries(records, pending, (record) => record.results).map((entry) => entry.resultId)).toEqual(["old-result", "new-result", "pending-result"]);
    });

    it("keeps standalone records isolated", () => {
        const standalone = { id: "standalone", createdAt: 1, results: [{ id: "result" }] };

        expect(workbenchConversationRecords([...records, standalone], standalone)).toEqual([standalone]);
    });

    it("groups history summaries by conversation without merging standalone records", () => {
        const standalone = { id: "standalone", createdAt: 1, results: [{ id: "result" }] };
        const groups = workbenchConversationRecordGroups([...records, standalone]);

        expect(groups.map((group) => [group.record.id, group.records.map((record) => record.id)])).toEqual([
            ["new", ["new", "old"]],
            ["other", ["other"]],
            ["standalone", ["standalone"]],
        ]);
    });

    it("uses the record identity when two rounds contain the same result id", () => {
        const duplicateIds = records.slice(0, 2).map((record) => ({ ...record, results: [{ id: "same" }] }));

        expect(workbenchConversationResultEntries(duplicateIds, duplicateIds[0], (record) => record.results).map((entry) => entry.key)).toEqual(["old:same", "new:same"]);
    });

    it("builds public history fallback messages without exposing an absent prompt", () => {
        expect(workbenchHistoryMessages({ id: "failed", status: "失败", error: "上游失败" }, "")).toEqual([{ id: "history-failed-assistant", role: "error", text: "上游失败" }]);
    });
});
