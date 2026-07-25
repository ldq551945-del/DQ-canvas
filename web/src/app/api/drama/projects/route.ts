import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { createDramaProjectForUser, DramaProjectServiceError, listDramaProjectSummariesForUser } from "@/lib/server/drama-project-service";

export async function GET() {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    return NextResponse.json({ code: 0, data: { projects: await listDramaProjectSummariesForUser(user.id) }, msg: "OK" });
}

export async function POST(request: Request) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    try {
        const project = await createDramaProjectForUser(user.id, await request.json().catch(() => ({})));
        return NextResponse.json({ code: 0, data: { project }, msg: "短剧项目已创建" });
    } catch (error) {
        if (error instanceof DramaProjectServiceError) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        throw error;
    }
}
