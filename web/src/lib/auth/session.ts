import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

import { deleteSession, getPublicUsersByIds, getUserBySession, sessionMaxAgeSeconds, type AuthSettings, type PublicUser } from "./store";
import { authorizedWorkerUserId } from "@/lib/server/maintenance-auth";
import { getTrustedForwardedProtocol } from "@/lib/trusted-proxy";

const SESSION_COOKIE_NAME = "dq_session";

type CurrentUser = PublicUser;

async function getSessionCookieValue() {
    const cookieStore = await cookies();
    return cookieStore.get(SESSION_COOKIE_NAME)?.value;
}

export async function getCurrentUser(request?: Request) {
    const sessionUser = await getUserBySession(await getSessionCookieValue());
    if (sessionUser || !request) return sessionUser;
    const workerUserId = authorizedWorkerUserId(request);
    if (!workerUserId) return null;
    const workerUser = (await getPublicUsersByIds([workerUserId]))[0];
    return workerUser?.status === "active" ? workerUser : null;
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
    const override = process.env.DQ_COOKIE_SECURE?.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(override || "")) return true;
    if (["0", "false", "no", "off"].includes(override || "")) return false;

    const forwardedProto = request ? getTrustedForwardedProtocol(request.headers) : "";
    if (forwardedProto) return forwardedProto === "https";

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
        accountId: user.accountId,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        bio: user.bio,
        avatarUrl: user.avatarUrl,
        role: user.role,
        status: user.status,
        planId: user.planId,
        planName: user.planName,
        hasActivePlan: user.hasActivePlan,
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
        site: {
            title: settings.site.title,
            logoUrl: settings.site.logoUrl,
            iconUrl: settings.site.iconUrl,
            seoTitle: settings.site.seoTitle,
            seoDescription: settings.site.seoDescription,
            seoKeywords: settings.site.seoKeywords,
            footerCopyright: settings.site.footerCopyright,
            termsUrl: settings.site.termsUrl,
            privacyUrl: settings.site.privacyUrl,
            homeShowcaseMode: settings.site.homeShowcaseMode,
            homeShowcaseItems: settings.site.homeShowcaseItems.map((item) => ({
                id: item.id,
                title: item.title,
                coverUrl: item.coverUrl,
                prompt: item.prompt,
                tags: [...item.tags],
                category: item.category,
            })),
            friendLinks: settings.site.friendLinks.map((item) => ({ id: item.id, label: item.label, url: item.url, enabled: item.enabled })),
            socials: Object.fromEntries(Object.entries(settings.site.socials).map(([key, item]) => [key, { enabled: item.enabled, label: item.label, url: item.url }])),
        },
        registrationEnabled: settings.registrationEnabled,
        emailRegistrationEnabled: settings.emailRegistrationEnabled,
        modelPointCosts: { ...settings.modelPointCosts },
        generationPointMultipliers: {
            imageQuality: { ...settings.generationPointMultipliers.imageQuality },
            videoQuality: { ...settings.generationPointMultipliers.videoQuality },
            videoSeconds: { ...settings.generationPointMultipliers.videoSeconds },
        },
        generationConcurrency: { ...settings.generationConcurrency },
        generationDefaults: {
            canvasImageCount: settings.generationDefaults.canvasImageCount,
            imageSize: settings.generationDefaults.imageSize,
            imageQuality: settings.generationDefaults.imageQuality,
            imageCount: settings.generationDefaults.imageCount,
            videoQuality: settings.generationDefaults.videoQuality,
            videoSeconds: settings.generationDefaults.videoSeconds,
            audioVoice: settings.generationDefaults.audioVoice,
            audioFormat: settings.generationDefaults.audioFormat,
            workbenchSmartPlanning: { ...settings.generationDefaults.workbenchSmartPlanning },
        },
        defaultModels: { ...settings.defaultModels },
        logicalModels: settings.logicalModels
            .filter((model) => model.enabled)
            .map((model) => ({
                id: model.id,
                name: model.name,
                capability: model.capability,
                enabled: true,
                bindings: model.bindings.filter((binding) => binding.enabled).map((binding) => ({ id: binding.id, channelId: binding.channelId, upstreamModel: binding.upstreamModel, enabled: true, priority: binding.priority })),
            })),
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
            })),
    };
}
