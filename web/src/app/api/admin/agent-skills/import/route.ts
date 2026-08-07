import { NextResponse } from "next/server";

import { isAuthInputError } from "@/lib/auth/store";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { AgentSkillRefinementError, refineImportedAgentSkill } from "@/lib/server/agent-skill-import-refiner";
import { GithubSkillImportError, importAgentSkillFromGithub } from "@/lib/server/github-agent-skill-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    try {
        const body = await readJsonBody<{ url?: unknown; path?: unknown }>(request, 32 * 1024);
        if (typeof body.url !== "string" || !body.url.trim()) return NextResponse.json({ error: "请输入 GitHub 地址" }, { status: 400 });
        if (body.url.length > 2_048 || (typeof body.path === "string" && body.path.length > 1_000)) return NextResponse.json({ error: "GitHub 地址或 Skill 路径过长" }, { status: 400 });
        const imported = await importAgentSkillFromGithub({ url: body.url, path: typeof body.path === "string" ? body.path : undefined });
        const result = imported.skill
            ? {
                  ...imported,
                  skill: await refineImportedAgentSkill({ skill: imported.skill, requestUrl: request.url, cookie: request.headers.get("cookie") || "", userId: currentUser.id }),
              }
            : imported;
        return NextResponse.json({ data: result, msg: result.skill ? "Skill 已由默认文本模型提取整理" : "请选择要提取的 Skill" }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
        if (error instanceof GithubSkillImportError || error instanceof AgentSkillRefinementError || isAuthInputError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("Admin GitHub Skill import failed", error instanceof Error ? error.message : error);
        return NextResponse.json({ error: "提取 GitHub Skill 失败" }, { status: 500 });
    }
}
