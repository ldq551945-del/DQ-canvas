import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { GalleryThemeToggle } from "@/app/gallery/gallery-theme-toggle";
import { SiteLogo } from "@/components/layout/site-logo";
import { getCurrentUser } from "@/lib/auth/session";
import { absoluteSiteUrl, getPublicSiteSettings, siteMetadataBase } from "@/lib/server/site-metadata";
import { getPublicCreatorPage, getPublicCreatorProfile, WorkCommunityServiceError } from "@/lib/server/work-community-service";
import type { PublicCreatorPage } from "@/services/api/work-community";
import { PublicCreatorView } from "./public-creator-view";

type CreatorPageProps = { params: Promise<{ username: string }> };

const loadCreatorProfile = cache(async (username: string) => {
    try {
        return await getPublicCreatorProfile(username);
    } catch (error) {
        if (error instanceof WorkCommunityServiceError && error.status === 404) return null;
        throw error;
    }
});

const loadCreatorPage = cache(async (username: string, viewerUserId: string) => {
    try {
        return (await getPublicCreatorPage(username, viewerUserId || undefined, { limit: 18 })) as PublicCreatorPage;
    } catch (error) {
        if (error instanceof WorkCommunityServiceError && error.status === 404) return null;
        throw error;
    }
});

export async function generateMetadata({ params }: CreatorPageProps): Promise<Metadata> {
    const { username } = await params;
    const [profile, site] = await Promise.all([loadCreatorProfile(username), getPublicSiteSettings()]);
    if (!profile) return { title: `创作者不存在 | ${site.title}`, robots: { index: false, follow: false } };
    const canonical = `/u/${encodeURIComponent(profile.username)}`;
    const title = `${profile.displayName || profile.username} (@${profile.username}) | ${site.title}`;
    const description = profile.bio || `查看 ${profile.displayName || profile.username} 发布的图片与视频作品。`;
    const image = absoluteSiteUrl(profile.avatarUrl || site.logoUrl || "/logo.svg", siteMetadataBase());
    return {
        metadataBase: siteMetadataBase(),
        title,
        description,
        alternates: { canonical },
        robots: { index: true, follow: true },
        openGraph: { type: "profile", title, description, siteName: site.title, url: canonical, images: [{ url: image, alt: profile.displayName || profile.username }], locale: "zh_CN" },
        twitter: { card: "summary", title, description, images: [image] },
    };
}

export default async function CreatorPage({ params }: CreatorPageProps) {
    const { username } = await params;
    const sitePromise = getPublicSiteSettings();
    const viewer = await getCurrentUser();
    const [site, data] = await Promise.all([sitePromise, loadCreatorPage(username, viewer?.id || "")]);
    if (!data) notFound();

    return (
        <main className="app-scroll-page bg-background text-foreground">
            <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-xl">
                <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center justify-between gap-3 px-3 sm:h-16 sm:px-6">
                    <Link href="/" className="flex min-w-0 items-center gap-2.5 text-foreground" aria-label={site.title}>
                        <SiteLogo logoUrl={site.logoUrl || "/logo.svg"} className="size-7 sm:size-8" />
                        <span className="truncate text-sm font-semibold sm:text-base">{site.title}</span>
                    </Link>
                    <div className="flex shrink-0 items-center gap-2">
                        <Link href="/gallery" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground transition hover:bg-muted">
                            作品广场
                        </Link>
                        <GalleryThemeToggle />
                    </div>
                </div>
            </header>
            <PublicCreatorView initialData={data} />
        </main>
    );
}
