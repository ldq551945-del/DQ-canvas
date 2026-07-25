import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { readJsonBody } from "@/lib/auth/request";
import { isAuthInputError } from "@/lib/auth/store";
import { checkRateLimit } from "@/lib/server/security";
import { planWorkbenchAgent, WorkbenchPlanningError, type WorkbenchRequestBody } from "@/lib/server/workbench-agent-service";

export async function POST(request: Request) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    const rate = await checkRateLimit(`agent-workbench:${user.id}`, { maxRequests: 30, windowMs: 60 * 1000 });
    if (!rate.allowed) return NextResponse.json({ code: 429, data: null, msg: "Agent 请求过于频繁，请稍后重试" }, { status: 429 });

    let body: WorkbenchRequestBody;
    try {
        body = await readJsonBody(request);
    } catch (error) {
        if (isAuthInputError(error)) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        throw error;
    }
    const prompt = String(body.prompt || "").trim();
    const submittedModels = Array.isArray(body.models) ? body.models : [];
    const selectedModels = Array.isArray(body.modelIds) ? body.modelIds : [];
    const submittedSkills = Array.isArray(body.skillIds) ? body.skillIds : [];
    if (!prompt) return NextResponse.json({ code: 400, data: null, msg: "创作需求不能为空" }, { status: 400 });
    if (prompt.length > 4000 || String(body.previousPrompt || "").length > 8000 || String(body.conversationId || "").length > 160 || submittedModels.length > 100 || selectedModels.length > 6 || submittedSkills.length > 8)
        return NextResponse.json({ code: 400, data: null, msg: "Agent 请求内容过长" }, { status: 400 });

    try {
        const modelPlan = await planWorkbenchAgent({ requestUrl: request.url, cookie: request.headers.get("cookie") || "", userId: user.id, body, prompt });
        return NextResponse.json({ code: 0, data: modelPlan, msg: "OK" });
    } catch (error) {
        if (error instanceof WorkbenchPlanningError) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        console.error("Workbench Agent planning failed", error);
        return NextResponse.json({ code: 502, data: null, msg: "Agent 文本规划失败，请检查默认文本模型和渠道" }, { status: 502 });
    }
}
