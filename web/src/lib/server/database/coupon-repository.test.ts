import { describe, expect, it, vi } from "vitest";

import type { QueryExecutor } from "./postgres";
import { CouponRepository } from "./coupon-repository";

describe("CouponRepository.listTemplates", () => {
    it("filters claimable templates by stock and the current user's lifetime limit", async () => {
        const query = vi.fn(async (..._args: unknown[]) => ({ rows: [] }));
        const repository = new CouponRepository({ query } as unknown as QueryExecutor);

        await repository.listTemplates({ claimableOnly: true, at: "2026-07-26T00:00:00.000Z", userId: "user-one", page: 2, pageSize: 10 });

        const [sql, params] = query.mock.calls[0] || [];
        expect(String(sql)).toContain("template.total_limit = 0 OR template.issued_count < template.total_limit");
        expect(String(sql)).toContain("coupon.template_id = template.id AND coupon.user_id = $4");
        expect(String(sql)).toContain("< template.per_user_limit");
        expect(params).toEqual([false, true, "2026-07-26T00:00:00.000Z", "user-one", 10, 10]);
    });
});

describe("CouponRepository.deleteTemplateIfUnused", () => {
    it("protects templates referenced by the referral program", async () => {
        const query = vi.fn(async (..._args: unknown[]) => ({ rows: [] }));
        const repository = new CouponRepository({ query } as unknown as QueryExecutor);

        await repository.deleteTemplateIfUnused("template-one");

        const [sql, params] = query.mock.calls[0] || [];
        expect(String(sql)).toContain("program.invitee_coupon_template_id = template.id");
        expect(params).toEqual(["template-one"]);
    });
});
