import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import type { ObjectStorageSettingsUpdate } from "@/lib/object-storage-contract";
import { getObjectStorageAdminSettings, saveObjectStorageAdminSettings } from "@/lib/server/object-storage-config";
import { checkConfiguredObjectStorage } from "@/lib/server/object-storage-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    const denied = await requireAdmin();
    if (denied) return denied;
    return NextResponse.json({ code: 0, data: await getObjectStorageAdminSettings(), msg: "OK" }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request) {
    const denied = await requireAdmin();
    if (denied) return denied;
    try {
        const body = (await request.json()) as Partial<ObjectStorageSettingsUpdate>;
        const data = await saveObjectStorageAdminSettings({
            enabled: body.enabled === true,
            endpoint: stringValue(body.endpoint),
            region: stringValue(body.region),
            bucket: stringValue(body.bucket),
            prefix: stringValue(body.prefix),
            forcePathStyle: body.forcePathStyle === true,
            accessKeyId: stringValue(body.accessKeyId),
            secretAccessKey: stringValue(body.secretAccessKey),
            clearAccessKeyId: body.clearAccessKeyId === true,
            clearSecretAccessKey: body.clearSecretAccessKey === true,
        });
        return NextResponse.json({ code: 0, data, msg: "外部存储配置已保存" }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
        return NextResponse.json({ code: 400, data: null, msg: error instanceof Error ? error.message : "外部存储配置保存失败" }, { status: 400 });
    }
}

export async function POST() {
    const denied = await requireAdmin();
    if (denied) return denied;
    try {
        await checkConfiguredObjectStorage();
        return NextResponse.json({ code: 0, data: { available: true }, msg: "外部存储连接正常" });
    } catch (error) {
        console.error("Object storage connection test failed", error);
        return NextResponse.json({ code: 502, data: { available: false }, msg: "连接失败，请检查 Endpoint、Region、Bucket 和访问密钥" }, { status: 502 });
    }
}

async function requireAdmin() {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    return user.role === "admin" ? null : NextResponse.json({ code: 403, data: null, msg: "需要管理员权限" }, { status: 403 });
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
}
