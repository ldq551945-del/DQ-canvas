import { NextResponse } from "next/server";

import { runBillingRefundReconciliationBatch } from "@/lib/server/billing-refund-orchestration-service";
import { getDatabaseProvider } from "@/lib/server/database";
import { getInstallStatus } from "@/lib/server/install-status";
import { isAuthorizedWorkerRequest, isWorkerTokenConfigured } from "@/lib/server/maintenance-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    if (!isWorkerTokenConfigured()) return NextResponse.json({ code: 503, data: null, msg: "Worker 令牌未配置" }, { status: 503 });
    if (!isAuthorizedWorkerRequest(request)) return NextResponse.json({ code: 401, data: null, msg: "Worker 认证失败" }, { status: 401 });
    const workerId = request.headers.get("x-dq-worker-id")?.trim() || "";
    if (!workerId) return NextResponse.json({ code: 400, data: null, msg: "退款 Worker ID 不能为空" }, { status: 400 });

    try {
        if (getDatabaseProvider() !== "postgres") return NextResponse.json({ code: 0, data: { claimed: 0 }, msg: "当前存储模式无需处理退款补偿任务" });
        if (!(await getInstallStatus()).database.schemaReady) return NextResponse.json({ code: 0, data: { claimed: 0 }, msg: "等待初始化数据库" });
        const result = await runBillingRefundReconciliationBatch({ workerId, limit: 10 });
        return NextResponse.json({ code: 0, data: result, msg: result.claimed ? `已处理 ${result.claimed} 个退款补偿任务` : "没有到期的退款补偿任务" });
    } catch (error) {
        console.error("Billing refund reconciliation batch failed", { workerId, error });
        return NextResponse.json({ code: 500, data: null, msg: "退款补偿任务执行失败" }, { status: 500 });
    }
}
