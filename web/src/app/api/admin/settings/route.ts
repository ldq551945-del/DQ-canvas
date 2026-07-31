import { NextResponse } from "next/server";

import { AuthInputError, getAuthSettings, isAuthInputError, setAuthSettings, type AuthSettings } from "@/lib/auth/store";
import { modelRoutingValidationErrors, normalizeDefaultModelsConfig, normalizeLogicalModelsConfig } from "@/lib/model-routing-config";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { mergeSystemChannelSecrets, serializeAdminSettings } from "@/lib/server/admin-channel-config";
import { auditActorFromRequest, safeRecordAuditLog } from "@/lib/server/audit-log-store";
import { invalidatePublicSiteSettings } from "@/lib/server/site-metadata";
import { channelProtocolValidationErrors } from "@/lib/channel-protocol-registry";

export const runtime = "nodejs";

export async function GET() {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    return NextResponse.json({ settings: serializeAdminSettings(await getAuthSettings()) });
}

export async function PATCH(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    try {
        const [body, currentSettings] = await Promise.all([readJsonBody<Partial<AuthSettings>>(request), getAuthSettings()]);
        const patch: Partial<AuthSettings> = {};
        if (body.site) patch.site = body.site;
        if (typeof body.registrationEnabled === "boolean") patch.registrationEnabled = body.registrationEnabled;
        if (typeof body.emailRegistrationEnabled === "boolean") patch.emailRegistrationEnabled = body.emailRegistrationEnabled;
        if (typeof body.freeDailyPointsEnabled === "boolean") patch.freeDailyPointsEnabled = body.freeDailyPointsEnabled;
        if (typeof body.freeDailyPoints === "number") patch.freeDailyPoints = body.freeDailyPoints;
        if (body.mail) patch.mail = body.mail;
        if (body.modelPointCosts && typeof body.modelPointCosts === "object") patch.modelPointCosts = body.modelPointCosts;
        if (body.generationPointMultipliers && typeof body.generationPointMultipliers === "object") patch.generationPointMultipliers = body.generationPointMultipliers;
        if (body.entitlements && typeof body.entitlements === "object") patch.entitlements = body.entitlements;
        if (body.generationConcurrency && typeof body.generationConcurrency === "object") patch.generationConcurrency = body.generationConcurrency;
        if (body.generationDefaults && typeof body.generationDefaults === "object") patch.generationDefaults = body.generationDefaults;
        if (Array.isArray(body.systemChannels)) patch.systemChannels = mergeSystemChannelSecrets(body.systemChannels, currentSettings.systemChannels);
        if (Array.isArray(body.systemChannels) || Array.isArray(body.logicalModels) || body.defaultModels) {
            const channels = patch.systemChannels || currentSettings.systemChannels;
            const protocolErrors = channels.flatMap(channelProtocolValidationErrors);
            if (protocolErrors.length) throw new AuthInputError(protocolErrors[0]);
            const sourceLogicalModels = Array.isArray(body.logicalModels) ? body.logicalModels : currentSettings.logicalModels;
            const defaultModels = { ...currentSettings.defaultModels, ...body.defaultModels };
            const normalizedDefaults = normalizeDefaultModelsConfig(defaultModels, sourceLogicalModels, channels);
            const errors = modelRoutingValidationErrors(sourceLogicalModels, channels, normalizedDefaults);
            if (errors.length) throw new AuthInputError(errors[0]);
            patch.logicalModels = normalizeLogicalModelsConfig(sourceLogicalModels, channels);
            patch.defaultModels = normalizeDefaultModelsConfig(normalizedDefaults, patch.logicalModels, channels);
        }
        if (Array.isArray(body.agentSkills)) patch.agentSkills = body.agentSkills;
        if (!Object.keys(patch).length) return NextResponse.json({ error: "没有可更新的设置" }, { status: 400 });

        const settings = await setAuthSettings(patch);
        if (patch.site) invalidatePublicSiteSettings();
        await safeRecordAuditLog({
            action: "admin.settings.update",
            actor: auditActorFromRequest(request, currentUser),
            target: { type: "settings", id: "auth" },
            metadata: { fields: Object.keys(patch) },
        });
        return NextResponse.json({ settings: serializeAdminSettings(settings) });
    } catch (error) {
        await safeRecordAuditLog({
            action: "admin.settings.update",
            status: "failure",
            actor: auditActorFromRequest(request, currentUser),
            target: { type: "settings", id: "auth" },
            metadata: { error: error instanceof Error ? error.message : "unknown" },
        });
        if (isAuthInputError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Admin settings update failed", error);
        return NextResponse.json({ error: "更新设置失败" }, { status: 500 });
    }
}
