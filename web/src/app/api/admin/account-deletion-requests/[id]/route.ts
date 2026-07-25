import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { AccountDeletionRequestError, reviewAccountDeletionRequest } from "@/lib/server/account-deletion-request-service";
import { auditActorFromRequest, safeRecordAuditLog } from "@/lib/server/audit-log-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ code: 403, data: null, msg: "需要管理员权限" }, { status: 403 });

    let action: "accepted" | "rejected" | undefined;
    let reviewNote = "";
    const { id } = await context.params;
    try {
        const body = await readJsonBody<{ status?: unknown; reviewNote?: unknown }>(request);
        action = body.status === "accepted" || body.status === "rejected" ? body.status : undefined;
        reviewNote = typeof body.reviewNote === "string" ? body.reviewNote : "";
        if (!action) throw new AccountDeletionRequestError("请选择受理或拒绝");
        const data = await reviewAccountDeletionRequest({ id, status: action, reviewNote, reviewer: currentUser });
        await safeRecordAuditLog({
            action: action === "accepted" ? "admin.account_deletion.accept" : "admin.account_deletion.reject",
            actor: auditActorFromRequest(request, currentUser),
            target: { type: "account_deletion_request", id: data.id, label: data.username },
            metadata: { status: data.status, reviewNote: data.reviewNote },
        });
        return NextResponse.json({ code: 0, data, msg: action === "accepted" ? "注销申请已受理" : "注销申请已拒绝" });
    } catch (error) {
        await safeRecordAuditLog({
            action: action === "rejected" ? "admin.account_deletion.reject" : "admin.account_deletion.accept",
            status: "failure",
            actor: auditActorFromRequest(request, currentUser),
            target: { type: "account_deletion_request", id },
            metadata: { reviewNote, error: error instanceof Error ? error.message : "unknown" },
        });
        if (error instanceof AccountDeletionRequestError) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        console.error("Account deletion request review failed", error);
        return NextResponse.json({ code: 500, data: null, msg: "注销申请处理失败" }, { status: 500 });
    }
}
