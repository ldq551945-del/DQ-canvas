import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { withPostgresTransaction, type QueryExecutor } from "./postgres";
import { WorkCommunityRepository } from "./work-community-repository";

const describePostgres = process.env.RUN_WORK_COMMUNITY_POSTGRES_INTEGRATION === "1" ? describe : describe.skip;

describePostgres("work community PostgreSQL integration", () => {
    it("returns authoritative state for like and work-author follow toggles", async () => {
        const rollbackOnly = new Error("rollback integration fixture");

        await expect(
            withPostgresTransaction(async (client) => {
                const creator = await findPublicCreator(client);
                expect(creator, "integration database needs one public profile work").toBeTruthy();
                if (!creator) throw rollbackOnly;

                const actor = await insertTestActor(client);
                const repository = new WorkCommunityRepository(client);

                await expect(repository.setLiked(creator.slug, actor.id, true, new Date().toISOString())).resolves.toMatchObject({ active: true, changed: true, likeCount: creator.likeCount + 1 });
                await expect(repository.setLiked(creator.slug, actor.id, true, new Date().toISOString())).resolves.toMatchObject({ active: true, changed: false, likeCount: creator.likeCount + 1 });
                await expect(repository.setLiked(creator.slug, actor.id, false, new Date().toISOString())).resolves.toMatchObject({ active: false, changed: true, likeCount: creator.likeCount });
                await expect(repository.setLiked(creator.slug, actor.id, false, new Date().toISOString())).resolves.toMatchObject({ active: false, changed: false, likeCount: creator.likeCount });

                await expect(repository.setFollowingAuthor(creator.slug, actor.id, true, new Date().toISOString())).resolves.toMatchObject({ active: true, changed: true });
                await expect(repository.setFollowingAuthor(creator.slug, actor.id, true, new Date().toISOString())).resolves.toMatchObject({ active: true, changed: false });
                await expect(repository.setFollowingAuthor(creator.slug, actor.id, false, new Date().toISOString())).resolves.toMatchObject({ active: false, changed: true });
                await expect(repository.setFollowingAuthor(creator.slug, actor.id, false, new Date().toISOString())).resolves.toMatchObject({ active: false, changed: false });

                throw rollbackOnly;
            }),
        ).rejects.toBe(rollbackOnly);
    });

    it("blocks a second account, removes both follow directions, and allows following after unblock", async () => {
        const rollbackOnly = new Error("rollback integration fixture");

        await expect(
            withPostgresTransaction(async (client) => {
                const creator = await findPublicCreator(client);
                expect(creator, "integration database needs one public profile work").toBeTruthy();
                if (!creator) throw rollbackOnly;

                const actor = await insertTestActor(client);
                await client.query(
                    `INSERT INTO user_follows (follower_user_id, followed_user_id, created_at)
                     VALUES ($1, $2, now()), ($2, $1, now())`,
                    [actor.id, creator.id],
                );

                const repository = new WorkCommunityRepository(client);
                const blocked = await repository.setBlockedUser(creator.username, actor.id, true, new Date().toISOString());
                expect(blocked).toMatchObject({ active: true, changed: true, removedFollowCount: 2 });
                await expect(repository.setBlockedUser(creator.username, actor.id, true, new Date().toISOString())).resolves.toMatchObject({ active: true, changed: false, removedFollowCount: 0 });
                await expect(relationCount(client, actor.id, creator.id)).resolves.toBe(0);
                await expect(repository.isBlockedUser(actor.id, creator.username)).resolves.toBe(true);
                await expect(repository.setFollowingUser(creator.username, actor.id, true, new Date().toISOString())).resolves.toBeNull();

                const [following, followers] = await Promise.all([repository.listUserFollows(actor.id), repository.listUserFollowers(actor.id)]);
                expect(following.items).toEqual([]);
                expect(followers.items).toEqual([]);

                const unblocked = await repository.setBlockedUser(creator.username, actor.id, false, new Date().toISOString());
                expect(unblocked).toMatchObject({ active: false, changed: true, removedFollowCount: 0 });
                await expect(repository.isBlockedUser(actor.id, creator.username)).resolves.toBe(false);
                await expect(repository.setFollowingUser(creator.username, actor.id, true, new Date().toISOString())).resolves.toMatchObject({ active: true, changed: true });
                await expect(repository.setFollowingUser(creator.username, actor.id, false, new Date().toISOString())).resolves.toMatchObject({ active: false, changed: true });
                await expect(repository.setBlockedUser(creator.username, actor.id, false, new Date().toISOString())).resolves.toMatchObject({ active: false, changed: false, removedFollowCount: 0 });

                throw rollbackOnly;
            }),
        ).rejects.toBe(rollbackOnly);
    });
});

async function findPublicCreator(client: QueryExecutor) {
    const result = await client.query<{ id: string; username: string; slug: string; like_count: number }>(
        `SELECT owner.id, owner.username, work.slug, work.like_count::int AS like_count
         FROM users owner
         JOIN published_works work ON work.owner_user_id = owner.id
         JOIN published_work_versions version ON version.id = work.published_version_id
         WHERE owner.status = 'active'
           AND work.lifecycle_status = 'active'
           AND version.moderation_status = 'approved'
           AND version.visibility = 'public'
           AND version.author_display = 'profile'
           AND EXISTS (
               SELECT 1 FROM published_work_assets asset
               WHERE asset.version_id = version.id
                 AND asset.role = 'content'
                 AND asset.media_type IN ('image', 'video')
           )
         ORDER BY work.updated_at DESC
         LIMIT 1`,
    );
    const row = result.rows[0];
    return row ? { id: row.id, username: row.username, slug: row.slug, likeCount: row.like_count } : undefined;
}

async function insertTestActor(client: QueryExecutor) {
    const actor = { id: randomUUID(), username: `community_test_${randomUUID().replaceAll("-", "").slice(0, 12)}` };
    await client.query(
        `INSERT INTO users (id, username, display_name, password_hash, status)
         VALUES ($1, $2, '社区集成测试用户', 'integration-test-only', 'active')`,
        [actor.id, actor.username],
    );
    return actor;
}

async function relationCount(client: QueryExecutor, leftUserId: string, rightUserId: string) {
    const result = await client.query<{ total: string }>(
        `SELECT count(*)::text AS total
         FROM user_follows
         WHERE (follower_user_id = $1 AND followed_user_id = $2)
            OR (follower_user_id = $2 AND followed_user_id = $1)`,
        [leftUserId, rightUserId],
    );
    return Number(result.rows[0]?.total || 0);
}
