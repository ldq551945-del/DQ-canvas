import { describe, expect, it, vi } from "vitest";

import type { QueryExecutor } from "./postgres";
import { WorkPublicationRepository } from "./work-publication-repository";

describe("WorkPublicationRepository", () => {
    it("only switches the public pointer to an approved version owned by the same work", async () => {
        const query = vi.fn(async (..._args: unknown[]) => ({ rows: [] }));
        const repository = new WorkPublicationRepository({ query } as unknown as QueryExecutor);

        await repository.setPublishedVersion("work-one", "version-two");

        const [sql, params] = query.mock.calls[0] || [];
        expect(String(sql)).toContain("version.id = $2 AND version.work_id = $1");
        expect(String(sql)).toContain("version.moderation_status = 'approved'");
        expect(String(sql)).toContain("lifecycle_status = 'active'");
        expect(params).toEqual(["work-one", "version-two"]);
    });

    it("rechecks lifecycle, moderation, visibility, and the active public version for every media read", async () => {
        const query = vi.fn(async (..._args: unknown[]) => ({ rows: [] }));
        const repository = new WorkPublicationRepository({ query } as unknown as QueryExecutor);

        await repository.getPublicAsset("public-work", "asset-one");

        const [sql, params] = query.mock.calls[0] || [];
        expect(String(sql)).toContain("version.id = work.published_version_id");
        expect(String(sql)).toContain("work.lifecycle_status = 'active'");
        expect(String(sql)).toContain("version.moderation_status = 'approved'");
        expect(String(sql)).toContain("version.visibility IN ('unlisted', 'public')");
        expect(params).toEqual(["public-work", "asset-one"]);
    });

    it("allocates the next version number inside the caller transaction", async () => {
        const query = vi.fn(async () => ({ rows: [{ next_version_number: "4" }] }));
        const repository = new WorkPublicationRepository({ query } as unknown as QueryExecutor);

        await expect(repository.getNextVersionNumber("work-one")).resolves.toBe(4);
        expect(query).toHaveBeenCalledWith(expect.stringContaining("max(version_number)"), ["work-one"]);
    });

    it("treats user and moderation take-downs as one user-facing filter", async () => {
        const query = vi.fn(async (..._args: unknown[]) => ({ rows: [] }));
        const repository = new WorkPublicationRepository({ query } as unknown as QueryExecutor);

        await repository.listWorks({ ownerUserId: "user-one", userStatus: "taken_down", page: 1, pageSize: 10 });

        const [sql, params] = query.mock.calls[0] || [];
        expect(String(sql)).toContain("work.lifecycle_status = 'revoked' OR current_version.moderation_status = 'taken_down'");
        expect(params).toEqual(["user-one", null, null, "", "%%", "taken_down", 10, 0]);
    });

    it("searches works by the padded public account id", async () => {
        const query = vi.fn(async (..._args: unknown[]) => ({ rows: [] }));
        const repository = new WorkPublicationRepository({ query } as unknown as QueryExecutor);

        await repository.listWorks({ keyword: "0001", page: 1, pageSize: 10 });

        const sql = String(query.mock.calls[0]?.[0]);
        expect(sql).toContain("owner.account_id AS owner_account_id");
        expect(sql).toContain("lpad(owner.account_id::text, 4, '0') LIKE $5");
        expect(query.mock.calls[0]?.[1]).toEqual([null, null, null, "0001", "%0001%", null, 10, 0]);
    });

    it("restores only an approved public version owned by the same work", async () => {
        const query = vi.fn(async (..._args: unknown[]) => ({ rows: [] }));
        const repository = new WorkPublicationRepository({ query } as unknown as QueryExecutor);

        await repository.getLatestApprovedPublicVersion("work-one", true);
        await repository.relistWork("work-one", "version-one");

        expect(String(query.mock.calls[0]?.[0])).toContain("moderation_status = 'approved'");
        expect(String(query.mock.calls[0]?.[0])).toContain("visibility IN ('unlisted', 'public')");
        expect(String(query.mock.calls[0]?.[0])).toContain("FOR UPDATE");
        expect(String(query.mock.calls[1]?.[0])).toContain("work.lifecycle_status = 'revoked'");
        expect(String(query.mock.calls[1]?.[0])).toContain("version.id = $2 AND version.work_id = work.id");
        expect(String(query.mock.calls[1]?.[0])).not.toContain("published_work_comments");
        expect(query.mock.calls[1]?.[1]).toEqual(["work-one", "version-one"]);
    });

    it("deletes the complete publication domain without deleting source projects or media", async () => {
        const query = vi.fn(async (sql: string, _params?: unknown[]) => ({ rows: sql.startsWith("DELETE FROM published_works WHERE") ? [{ id: "work-one" }] : [] }));
        const repository = new WorkPublicationRepository({ query } as unknown as QueryExecutor);

        await expect(repository.deleteWorkCompletely("work-one")).resolves.toBe("work-one");

        const statements = query.mock.calls.map(([sql]) => String(sql));
        expect(statements).toHaveLength(7);
        expect(statements).toEqual([
            expect.stringContaining("DELETE FROM user_notifications"),
            expect.stringContaining("DELETE FROM published_work_cases"),
            expect.stringContaining("DELETE FROM published_work_assets"),
            expect.stringContaining("DELETE FROM published_work_likes"),
            expect.stringContaining("UPDATE published_works SET current_version_id = NULL"),
            expect.stringContaining("DELETE FROM published_work_versions"),
            expect.stringContaining("DELETE FROM published_works WHERE"),
        ]);
        expect(query.mock.calls.every(([, params]) => JSON.stringify(params) === JSON.stringify(["work-one"]))).toBe(true);
        expect(statements.join("\n")).not.toMatch(/DELETE FROM (library_assets|canvas_projects|drama_projects|local_media_assets)/);
    });
});
