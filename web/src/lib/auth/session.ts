import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

import { deleteSession, getUserBySession, sessionMaxAgeSeconds, type AuthSettings, type PublicUser } from "./store";

const SESSION_COOKIE_NAME = "vozeb_pro_session";

type CurrentUser = PublicUser;

async function getSessionCookieValue() {
    const cookieStore = await cookies();
    return cookieStore.get(SESSION_COOKIE_NAME)?.value;
}

export async function getCurrentUser() {
    return getUserBySession(await getSessionCookieValue());
}

export async function clearCurrentSession() {
    await deleteSession(await getSessionCookieValue());
}

export function setSessionCookie(response: NextResponse, value: string, request?: Request) {
    response.cookies.set(SESSION_COOKIE_NAME, value, {
        httpOnly: true,
        sameSite: "lax",
        secure: shouldUseSecureSessionCookie(request),
        maxAge: sessionMaxAgeSeconds(),
        path: "/",
    });
}

export function clearSessionCookie(response: NextResponse, request?: Request) {
    const secure = shouldUseSecureSessionCookie(request);
    response.cookies.set(SESSION_COOKIE_NAME, "", {
        httpOnly: true,
        sameSite: "lax",
        secure,
        maxAge: 0,
        path: "/",
    });
}

function shouldUseSecureSessionCookie(request?: Request) {
    const override = process.env.VOZEB_PRO_COOKIE_SECURE?.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(override || "")) return true;
    if (["0", "false", "no", "off"].includes(override || "")) return false;

    const forwardedProto = request?.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
    if (forwardedProto) return forwardedProto === "https";

    const forwarded = request?.headers.get("forwarded") || "";
    const forwardedProtoMatch = forwarded.match(/(?:^|;|,)\s*proto=([^;,]+)/i);
    if (forwardedProtoMatch?.[1]) return forwardedProtoMatch[1].replace(/^"|"$/g, "").toLowerCase() === "https";

    if (request?.url) {
        try {
            return new URL(request.url).protocol === "https:";
        } catch {
            return false;
        }
    }

    return false;
}

export function serializeCurrentUser(user: CurrentUser) {
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        status: user.status,
        planId: user.planId,
        planName: user.planName,
        pointsBalance: user.pointsBalance,
        permanentPointsBalance: user.permanentPointsBalance,
        dailyPointsBalance: user.dailyPointsBalance,
        dailyPointsExpiresAt: user.dailyPointsExpiresAt,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastLoginAt: user.lastLoginAt,
    };
}

export function serializePublicSettings(settings: AuthSettings) {
    return {
        site: settings.site,
        registrationEnabled: settings.registrationEnabled,
        emailRegistrationEnabled: settings.emailRegistrationEnabled,
        modelPointCosts: settings.modelPointCosts,
        generationPointMultipliers: settings.generationPointMultipliers,
        entitlements: {
            enabled: settings.entitlements.enabled,
            defaultPlanId: settings.entitlements.defaultPlanId,
            plans: settings.entitlements.plans.filter((plan) => plan.enabled).map((plan) => ({ id: plan.id, name: plan.name, features: plan.features })),
        },
        generationConcurrency: settings.generationConcurrency,
        generationDefaults: settings.generationDefaults,
        defaultModels: settings.defaultModels,
        logicalModels: settings.logicalModels,
        systemChannels: settings.systemChannels
            .filter((channel) => channel.enabled)
            .map((channel) => ({
                id: channel.id,
                name: channel.name,
                baseUrl: `/api/ai/system/${channel.id}`,
                apiKey: "system",
                apiFormat: channel.apiFormat,
                models: channel.models,
                enabled: channel.enabled,
                hasApiKey: Boolean(channel.apiKey),
                advancedConfig: channel.advancedConfig,
            })),
    };
}
