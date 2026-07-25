"use client";

import { type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Camera, Clapperboard, Image as ImageIcon, Mail, Send, ShoppingBag, Sparkles, WandSparkles } from "lucide-react";
import { Button, Image, Modal } from "antd";

import { AuthForm } from "@/components/auth/auth-form";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { navigationTools } from "@/constant/navigation-tools";
import { fetchPrompts, type Prompt } from "@/services/api/prompts";
import { type LocalUser, useUserStore } from "@/stores/use-user-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { usePublicSessionStore } from "@/stores/use-public-session-store";
import { imagePreviewUrl } from "@/lib/media-image-url";
import { cn } from "@/lib/utils";
import "./landing.css";

type SessionPayload = {
    user?: LocalUser | null;
    install?: {
        firstAdminRequired?: boolean;
        database?: {
            healthy?: boolean;
        };
    };
    settings?: {
        site?: {
            title: string;
            logoUrl: string;
            seoDescription?: string;
            footerCopyright?: string;
            termsUrl?: string;
            privacyUrl?: string;
            homeShowcaseMode?: SiteShowcaseMode;
            homeShowcaseItems?: SiteShowcaseItem[];
            friendLinks?: SiteFriendLink[];
            socials?: SiteSocialSettings;
        };
    };
};

type SiteSocialKey = "email" | "telegram" | "x" | "instagram";

type SiteSocialSettings = Record<SiteSocialKey, { enabled: boolean; label: string; url: string }>;
type SiteFriendLink = { id: string; label: string; url: string; enabled: boolean };
type SiteShowcaseMode = "random" | "custom";
type SiteShowcaseItem = { id: string; title: string; coverUrl: string; prompt: string; tags: string[]; category: string };

const defaultSite: {
    title: string;
    logoUrl: string;
    seoDescription: string;
    footerCopyright: string;
    termsUrl: string;
    privacyUrl: string;
    homeShowcaseMode: SiteShowcaseMode;
    homeShowcaseItems: SiteShowcaseItem[];
    friendLinks: SiteFriendLink[];
    socials: SiteSocialSettings;
} = {
    title: "VOZEB PRO",
    logoUrl: "/logo.svg",
    seoDescription: "面向 AI 图片创作与管理的 VOZEB PRO 工作台",
    footerCopyright: "© 2026 VOZEB PRO. All rights reserved.",
    termsUrl: "/terms",
    privacyUrl: "/privacy",
    homeShowcaseMode: "random",
    homeShowcaseItems: [],
    friendLinks: [
        { id: "vozeb-pro-home", label: "VOZEB PRO", url: "https://www.vozeb.com/", enabled: true },
        { id: "qq-vozeb-open-source", label: "VOZEB 开源交流 QQ 群", url: "https://qm.qq.com/q/9MVLTxuRd6", enabled: true },
        { id: "linux-do", label: "Linux.do", url: "https://linux.do/", enabled: true },
    ],
    socials: {
        email: { enabled: true, label: "邮箱联系", url: "mailto:csyqlz@gmail.com" },
        telegram: { enabled: false, label: "Telegram", url: "" },
        x: { enabled: false, label: "X", url: "" },
        instagram: { enabled: false, label: "Instagram", url: "" },
    } satisfies SiteSocialSettings,
};

const socialIconByKey: Record<SiteSocialKey, ReactNode> = {
    email: <Mail className="size-4" />,
    telegram: <Send className="size-4" />,
    x: <span className="text-base font-black leading-none">X</span>,
    instagram: <Camera className="size-4" />,
};

const publicPrefetchRoutes = ["/login", "/register", "/forgot-password", "/privacy", "/terms"];
const authenticatedPrefetchRoutes = navigationTools.map((tool) => `/${tool.slug}`);
const landingNavTools = navigationTools.slice(0, 4);
const heroWorkflowItems = ["选场景", "加参考", "写描述", "生成", "微调", "保存"];
const heroValueItems = [
    { icon: <ShoppingBag className="size-4" />, label: "电商", tone: "commerce" },
    { icon: <Clapperboard className="size-4" />, label: "短剧", tone: "comic" },
    { icon: <ImageIcon className="size-4" />, label: "美颜", tone: "beauty" },
];
const heroPipelineItems = [
    { name: "参考图识别", status: "完成", progress: "100%" },
    { name: "风格生成", status: "生成中", progress: "76%" },
    { name: "细节优化", status: "待处理", progress: "42%" },
];
const heroOutputItems = [
    { icon: <ShoppingBag className="size-5" />, label: "电商", title: "上新视觉", detail: "商品展示 / 海报 / 详情", tone: "commerce" },
    { icon: <Clapperboard className="size-5" />, label: "短剧", title: "角色分镜", detail: "封面 / 连载 / 对话", tone: "comic" },
    { icon: <ImageIcon className="size-5" />, label: "美颜", title: "人像精修", detail: "肤色 / 光影 / 质感", tone: "beauty" },
];
const homeShowcaseItems = [
    { id: "commerce", icon: <ShoppingBag className="size-5" />, label: "电商", title: "上新主图与详情视觉", text: "商品、背景、卖点和版式可以连续生成，适合日常上新和活动图。", tags: ["商品主图", "活动海报", "详情页"], tone: "commerce" },
    { id: "comic", icon: <Clapperboard className="size-5" />, label: "短剧", title: "角色封面与分镜", text: "固定角色、画风和镜头节奏，快速生成封面、连载图和剧情分镜。", tags: ["角色设定", "分镜", "封面"], tone: "comic" },
    { id: "beauty", icon: <ImageIcon className="size-5" />, label: "美颜", title: "自然人像精修", text: "保留人物特征，统一肤色、光影和质感，让头像、写真和展示图更干净。", tags: ["肤色", "光影", "质感"], tone: "beauty" },
    { id: "style", icon: <WandSparkles className="size-5" />, label: "复用", title: "常用风格一键继续", text: "把好看的参考图、提示和结果保存起来，下次不用从零开始。", tags: ["参考图", "常用风格", "继续创作"], tone: "style" },
];

export default function HomePage() {
    const router = useRouter();
    const [primaryTool] = navigationTools;
    const navItemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
    const showcaseRef = useRef<HTMLElement | null>(null);
    const promptLinkRef = useRef<HTMLSpanElement | null>(null);
    const showcaseRequestedRef = useRef(false);
    const [promptShowcase, setPromptShowcase] = useState<Prompt[]>([]);
    const [showcaseLoading, setShowcaseLoading] = useState(true);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [authOpen, setAuthOpen] = useState(false);
    const [navActiveIndex, setNavActiveIndex] = useState(0);
    const [navIndicator, setNavIndicator] = useState({ left: 5, width: 0, visible: false });
    const [site, setSite] = useState(defaultSite);
    const user = useUserStore((state) => state.user);
    const sessionPayload = usePublicSessionStore((state) => state.payload);
    const sessionReady = usePublicSessionStore((state) => state.ready);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const friendLinks = (site.friendLinks || []).filter((link) => link.enabled && link.url);
    const showcaseCards = homeShowcaseItems;
    const previewItems = promptShowcase.filter((item) => item.coverUrl);
    const hasVerifiedUser = sessionReady && Boolean(user);
    const siteTitle = site.title || "VOZEB PRO";

    const moveNavIndicator = useCallback((index: number) => {
        const item = navItemRefs.current[index];
        if (!item) return;
        setNavActiveIndex(index);
        setNavIndicator({ left: item.offsetLeft, width: item.offsetWidth, visible: true });
    }, []);

    const handleHeroPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        if (event.pointerType === "touch") return;
        const rect = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        event.currentTarget.style.setProperty("--landing-pointer-x", `${Math.round(x * 100)}%`);
        event.currentTarget.style.setProperty("--landing-pointer-y", `${Math.round(y * 100)}%`);
        event.currentTarget.style.setProperty("--landing-scene-x", `${((x - 0.5) * 24).toFixed(2)}px`);
        event.currentTarget.style.setProperty("--landing-scene-y", `${((y - 0.5) * 18).toFixed(2)}px`);
        event.currentTarget.style.setProperty("--landing-float-x", `${((x - 0.5) * 38).toFixed(2)}px`);
        event.currentTarget.style.setProperty("--landing-float-y", `${((y - 0.5) * 26).toFixed(2)}px`);
        event.currentTarget.style.setProperty("--landing-float-reverse-x", `${((0.5 - x) * 32).toFixed(2)}px`);
        event.currentTarget.style.setProperty("--landing-float-reverse-y", `${((0.5 - y) * 22).toFixed(2)}px`);
    }, []);

    const handleHeroPointerLeave = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        event.currentTarget.style.setProperty("--landing-pointer-x", "50%");
        event.currentTarget.style.setProperty("--landing-pointer-y", "42%");
        event.currentTarget.style.setProperty("--landing-scene-x", "0px");
        event.currentTarget.style.setProperty("--landing-scene-y", "0px");
        event.currentTarget.style.setProperty("--landing-float-x", "0px");
        event.currentTarget.style.setProperty("--landing-float-y", "0px");
        event.currentTarget.style.setProperty("--landing-float-reverse-x", "0px");
        event.currentTarget.style.setProperty("--landing-float-reverse-y", "0px");
    }, []);

    const handleWorkbenchPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.pointerType === "touch") return;
        const rect = event.currentTarget.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
        event.currentTarget.style.setProperty("--workbench-rotate-x", `${((0.5 - y) * 6).toFixed(2)}deg`);
        event.currentTarget.style.setProperty("--workbench-rotate-y", `${((x - 0.5) * 6).toFixed(2)}deg`);
        event.currentTarget.style.setProperty("--workbench-shadow-x", `${((0.5 - x) * 22).toFixed(2)}px`);
        event.currentTarget.style.setProperty("--workbench-shadow-y", `${((0.5 - y) * 16 + 28).toFixed(2)}px`);
    }, []);

    const handleWorkbenchPointerLeave = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        event.currentTarget.style.setProperty("--workbench-rotate-x", "0deg");
        event.currentTarget.style.setProperty("--workbench-rotate-y", "0deg");
        event.currentTarget.style.setProperty("--workbench-shadow-x", "0px");
        event.currentTarget.style.setProperty("--workbench-shadow-y", "28px");
    }, []);

    const handleShowcasePointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        if (event.pointerType === "touch") return;
        event.currentTarget.classList.add("is-pointer-active");
        const rect = event.currentTarget.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
        event.currentTarget.style.setProperty("--card-pointer-x", `${(x * 100).toFixed(1)}%`);
        event.currentTarget.style.setProperty("--card-pointer-y", `${(y * 100).toFixed(1)}%`);
        event.currentTarget.style.setProperty("--card-tilt-x", `${((0.5 - y) * 5).toFixed(2)}deg`);
        event.currentTarget.style.setProperty("--card-tilt-y", `${((x - 0.5) * 6).toFixed(2)}deg`);
        event.currentTarget.style.setProperty("--card-icon-x", `${((x - 0.5) * 4).toFixed(2)}px`);
        event.currentTarget.style.setProperty("--card-icon-y", `${((y - 0.5) * 4).toFixed(2)}px`);
    }, []);

    const handleShowcasePointerLeave = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        event.currentTarget.classList.remove("is-pointer-active");
        event.currentTarget.style.setProperty("--card-pointer-x", "78%");
        event.currentTarget.style.setProperty("--card-pointer-y", "18%");
        event.currentTarget.style.setProperty("--card-tilt-x", "0deg");
        event.currentTarget.style.setProperty("--card-tilt-y", "0deg");
        event.currentTarget.style.setProperty("--card-icon-x", "0px");
        event.currentTarget.style.setProperty("--card-icon-y", "0px");
    }, []);

    const handlePromptLinkMagnet = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        const node = promptLinkRef.current;
        if (!node || event.pointerType === "touch") return;
        const rect = node.getBoundingClientRect();
        const dx = event.clientX - (rect.left + rect.width / 2);
        const dy = event.clientY - (rect.top + rect.height / 2);
        const reach = Math.max(rect.width, rect.height) / 2 + 30;
        const distance = Math.hypot(dx, dy);
        const strength = distance < reach ? 1 - distance / reach : 0;
        node.style.setProperty("--magnet-x", `${Math.max(-4, Math.min(4, dx * strength * 0.08)).toFixed(2)}px`);
        node.style.setProperty("--magnet-y", `${Math.max(-3, Math.min(3, dy * strength * 0.08)).toFixed(2)}px`);
    }, []);

    const resetPromptLinkMagnet = useCallback(() => {
        promptLinkRef.current?.style.setProperty("--magnet-x", "0px");
        promptLinkRef.current?.style.setProperty("--magnet-y", "0px");
    }, []);

    const openProtectedEntry = (path: string) => {
        if (hasVerifiedUser) {
            router.push(path);
            return;
        }
        setAuthOpen(true);
    };

    useLayoutEffect(() => {
        moveNavIndicator(0);
        const handleResize = () => moveNavIndicator(0);
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [moveNavIndicator]);

    useEffect(() => {
        const routes = user ? [...authenticatedPrefetchRoutes, "/profile"] : publicPrefetchRoutes;
        return prefetchRoutesAfterIdle(routes, router.prefetch);
    }, [router, user]);

    useEffect(() => {
        if (!sessionReady) return;
        const data = sessionPayload as SessionPayload | null;
        if (data?.install && (!data.install.database?.healthy || data.install.firstAdminRequired)) {
            router.replace("/install");
            return;
        }
        if (data?.settings?.site) setSite({ ...defaultSite, ...data.settings.site });
    }, [router, sessionPayload, sessionReady]);

    useEffect(() => {
        if (!sessionReady) return;

        if (site.homeShowcaseMode === "custom") {
            showcaseRequestedRef.current = true;
            setPromptShowcase(siteShowcaseItemsToPrompts(site.homeShowcaseItems));
            setShowcaseLoading(false);
            return;
        }

        showcaseRequestedRef.current = false;
        setPromptShowcase([]);
        setShowcaseLoading(true);
        let cancelled = false;
        let idleHandle: number | undefined;
        let timeoutHandle: ReturnType<typeof globalThis.setTimeout> | undefined;
        let observer: IntersectionObserver | undefined;

        const loadShowcase = () => {
            void fetchPrompts({ pageSize: 9, random: true })
                .then((data) => {
                    if (!cancelled) setPromptShowcase(data.items);
                })
                .catch(() => {
                    if (!cancelled) setPromptShowcase([]);
                })
                .finally(() => {
                    if (!cancelled) setShowcaseLoading(false);
                });
        };

        const scheduleLoad = () => {
            if (showcaseRequestedRef.current) return;
            showcaseRequestedRef.current = true;
            if ("requestIdleCallback" in window) {
                idleHandle = window.requestIdleCallback(loadShowcase, { timeout: 1800 });
            } else {
                timeoutHandle = globalThis.setTimeout(loadShowcase, 600);
            }
        };

        const section = showcaseRef.current;
        if (!section || !("IntersectionObserver" in window)) {
            timeoutHandle = globalThis.setTimeout(scheduleLoad, 900);
            return () => {
                cancelled = true;
                if (timeoutHandle) globalThis.clearTimeout(timeoutHandle);
            };
        }

        observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    observer?.disconnect();
                    scheduleLoad();
                }
            },
            { rootMargin: "360px 0px" },
        );
        observer.observe(section);

        return () => {
            cancelled = true;
            observer?.disconnect();
            if (idleHandle && "cancelIdleCallback" in window) window.cancelIdleCallback(idleHandle);
            if (timeoutHandle) globalThis.clearTimeout(timeoutHandle);
        };
    }, [sessionReady, site.homeShowcaseItems, site.homeShowcaseMode]);

    return (
        <main className="app-scroll-page landing-home-v2 relative bg-[#f5f5f7] text-stone-950 dark:bg-[#050505] dark:text-white" onPointerMove={handleHeroPointerMove} onPointerLeave={handleHeroPointerLeave}>
            <section className="landing-moon-hero relative overflow-hidden">
                <div className="landing-moon-grid" aria-hidden="true" />
                <div className="landing-moon-scan" aria-hidden="true" />
                <header className="landing-moon-header relative z-20 mx-auto flex h-20 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
                    <Link href="/" className="landing-moon-brand inline-flex min-w-0 items-center gap-3 text-stone-950 dark:text-white">
                        <SiteLogo logoUrl={site.logoUrl} className="size-9 bg-stone-950 dark:bg-white" />
                        <span className="truncate text-lg font-semibold tracking-normal">{siteTitle}</span>
                    </Link>
                    <nav className="landing-moon-nav hidden items-center gap-1 md:flex" onPointerLeave={() => moveNavIndicator(0)}>
                        <span className="landing-moon-nav-indicator" style={{ left: navIndicator.left, opacity: navIndicator.visible ? 1 : 0, width: navIndicator.width }} />
                        {landingNavTools.map((tool, index) => (
                            <Link
                                key={tool.slug}
                                ref={(node) => {
                                    navItemRefs.current[index] = node;
                                }}
                                href={`/${tool.slug}`}
                                prefetch
                                className={cn("landing-moon-nav-link", navActiveIndex === index && "is-active")}
                                onFocus={() => moveNavIndicator(index)}
                                onPointerEnter={() => moveNavIndicator(index)}
                            >
                                {tool.label}
                            </Link>
                        ))}
                    </nav>
                    <div className="landing-moon-actions flex items-center justify-end gap-2">
                        <AnimatedThemeToggler
                            theme={theme}
                            onThemeChange={setTheme}
                            className="landing-theme-toggle landing-moon-theme"
                            aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
                            title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
                        />
                        <Button className="landing-login-button landing-moon-login" onClick={() => openProtectedEntry("/create")}>
                            {hasVerifiedUser ? "进入工作台" : "登录"}
                        </Button>
                    </div>
                </header>

                <div className="landing-moon-hero-inner landing-hero-layout relative z-10 mx-auto grid min-h-[calc(100dvh-8.5rem)] max-w-[1500px] grid-cols-1 items-center gap-8 px-4 pb-12 pt-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(460px,0.92fr)] lg:gap-14 lg:px-8 xl:gap-20">
                    <div className="landing-hero-copy-panel">
                        <div className="landing-hero-heading">
                            <h1 className={cn("landing-hero-title text-balance font-semibold tracking-normal text-stone-950 dark:text-white", siteTitle.length > 8 && "is-long-title")} title={siteTitle}>
                                {siteTitle}
                            </h1>
                            <div className="landing-hero-badge inline-flex items-center gap-2">
                                <Sparkles className="size-4" />
                                <span>Agent 创作入口</span>
                            </div>
                        </div>
                        <p className="landing-hero-description mt-6 max-w-2xl text-stone-600 dark:text-white/68">从商品展示到短剧分镜，再到人像精修，把想法、参考图和常用风格放在同一个入口，快速得到可继续编辑的视觉结果。</p>
                        <div className="landing-hero-proof-grid mt-7" role="list" aria-label="创作场景">
                            <i className="landing-scene-slider" aria-hidden="true" />
                            {heroValueItems.map((item) => (
                                <div key={item.label} role="listitem" className={cn("landing-scene-tab", `is-${item.tone}`)}>
                                    <i className="landing-scene-tab-icon" aria-hidden="true">
                                        {item.icon}
                                    </i>
                                    <b>{item.label}</b>
                                </div>
                            ))}
                        </div>
                        <div className="landing-hero-chain is-auto-flow mt-8">
                            {heroWorkflowItems.map((item, index) => (
                                <span key={item} className="landing-hero-chain-item">
                                    <span>{String(index + 1).padStart(2, "0")}</span>
                                    {item}
                                </span>
                            ))}
                            <i className="landing-hero-chain-fill" aria-hidden="true" />
                        </div>
                        <div className="landing-moon-hero-actions mt-8 flex flex-wrap items-center gap-3">
                            <Button className="landing-hero-cta landing-moon-primary" type="primary" size="large" onClick={() => openProtectedEntry(`/${primaryTool.slug}`)} icon={<ArrowRight className="size-5" />} iconPlacement="end">
                                开始创作
                            </Button>
                        </div>
                    </div>

                    <div className="landing-moon-preview landing-workbench-preview" aria-hidden="true" onPointerMove={handleWorkbenchPointerMove} onPointerLeave={handleWorkbenchPointerLeave}>
                        <div className="landing-moon-window">
                            <div className="landing-moon-window-top">
                                <span />
                                <span />
                                <span />
                                <strong>{siteTitle} Creative Studio</strong>
                                <em>创作任务 / 生成中</em>
                            </div>
                            <div className="landing-moon-canvas">
                                <div className="landing-creative-board">
                                    <div className="landing-creative-board-head">
                                        <div>
                                            <span>AI 创作台</span>
                                            <strong>电商、短剧与美颜</strong>
                                        </div>
                                        <div className="landing-creative-status">
                                            <WandSparkles className="size-4" />
                                            正在生成
                                        </div>
                                    </div>

                                    <div className="landing-creative-stage">
                                        <div className="landing-creative-input-card">
                                            <span>输入</span>
                                            <strong>参考图 + 一句话</strong>
                                            <p>保持风格、比例与人物特征，自动拆成多组可编辑结果。</p>
                                            <i />
                                        </div>
                                        <div className="landing-creative-output-wall">
                                            {heroOutputItems.map((item, index) => (
                                                <div key={item.label} className={cn("landing-creative-output-card", index === 0 && "is-featured", `is-${item.tone}`)}>
                                                    <div className="landing-creative-output-art">{item.icon}</div>
                                                    <span>{item.label}</span>
                                                    <strong>{item.title}</strong>
                                                    <small>{item.detail}</small>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="landing-creative-prompt">
                                        <div>
                                            <span>当前描述</span>
                                            <strong>夏季上新、漫画分镜、自然人像光</strong>
                                        </div>
                                        <em>12 个结果</em>
                                    </div>

                                    <div className="landing-creative-pipeline">
                                        {heroPipelineItems.map((item) => (
                                            <div key={item.name} className="landing-creative-pipeline-item">
                                                <div>
                                                    <span>{item.name}</span>
                                                    <strong>{item.status}</strong>
                                                </div>
                                                <i>
                                                    <b style={{ width: item.progress }} />
                                                </i>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section ref={showcaseRef} className="landing-showcase-section relative z-10 overflow-hidden px-4 pb-20 sm:px-6">
                <div className="landing-showcase-shell mx-auto max-w-[1200px]">
                    <div className="landing-showcase-header relative z-10 mb-8">
                        <div>
                            <h2 className="text-2xl font-semibold text-stone-950 sm:text-3xl dark:text-white">常用场景，直接开做</h2>
                            <p className="mt-3 max-w-2xl text-base leading-7 text-stone-600 dark:text-stone-400">电商、短剧、美颜和常用风格都能保存下来，下次从熟悉的入口继续创作。</p>
                        </div>
                    </div>
                    <div className="landing-showcase-grid relative z-10 grid auto-rows-[190px] gap-4 sm:grid-cols-2 md:grid-cols-4 sm:auto-rows-[200px] md:auto-rows-[190px]">
                        {showcaseCards.map((item, index) => (
                            <button
                                key={item.id}
                                type="button"
                                aria-label={`${item.label}：${item.title}`}
                                onClick={() => openProtectedEntry(`/${primaryTool.slug}`)}
                                onPointerMove={handleShowcasePointerMove}
                                onPointerLeave={handleShowcasePointerLeave}
                                className={cn("landing-showcase-card group relative cursor-pointer overflow-hidden text-left", `is-${item.tone}`, index === 0 && "md:col-span-2 md:row-span-2", index === 3 && "md:col-span-2")}
                            >
                                <div className="landing-showcase-card-visual transition duration-500 group-hover:scale-[1.03]">
                                    <span>{item.icon}</span>
                                </div>
                                <div className="landing-showcase-card-copy">
                                    <div className="landing-showcase-card-label">{item.label}</div>
                                    <h3>{item.title}</h3>
                                    <p>{item.text}</p>
                                    <div className="landing-showcase-card-tags">
                                        {item.tags.map((tag) => (
                                            <span key={tag}>{tag}</span>
                                        ))}
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                    <div className="landing-prompt-gallery">
                        <div className="landing-prompt-gallery-head" onPointerMove={handlePromptLinkMagnet} onPointerLeave={resetPromptLinkMagnet}>
                            <div>
                                <h3>{site.homeShowcaseMode === "custom" ? "精选灵感图" : "随机灵感图"}</h3>
                            </div>
                            <span ref={promptLinkRef} className="landing-prompt-gallery-link-magnet">
                                <Button className="landing-prompt-gallery-link" type="link" href="/prompts" icon={<ArrowRight className="size-4" />} iconPlacement="end">
                                    公共提示词库
                                </Button>
                            </span>
                        </div>
                        <div className="landing-prompt-gallery-grid">
                            {promptShowcase.length ? (
                                promptShowcase.slice(0, 9).map((item, index) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className={cn("landing-prompt-card group", index === 0 && "is-featured")}
                                        aria-label={`${item.title}，查看提示词封面`}
                                        onClick={() => {
                                            if (!item.coverUrl) return;
                                            setPreviewIndex(
                                                Math.max(
                                                    0,
                                                    previewItems.findIndex((preview) => preview.id === item.id),
                                                ),
                                            );
                                            setPreviewOpen(true);
                                        }}
                                    >
                                        {item.coverUrl ? <img src={imagePreviewUrl(item.coverUrl, 640)} alt={item.title} loading="lazy" referrerPolicy="no-referrer" /> : <span className="landing-prompt-card-fallback" />}
                                        <div className="landing-prompt-card-copy">
                                            <strong>{item.title}</strong>
                                            <div>
                                                {item.tags.slice(0, 2).map((tag) => (
                                                    <span key={tag}>{tag}</span>
                                                ))}
                                            </div>
                                        </div>
                                    </button>
                                ))
                            ) : showcaseLoading ? (
                                Array.from({ length: 9 }).map((_, index) => <div key={index} className={cn("landing-prompt-card is-loading", index === 0 && "is-featured")} />)
                            ) : (
                                <div className="landing-prompt-gallery-empty">{site.homeShowcaseMode === "custom" ? "暂无精选内容，请在管理后台添加首页展示。" : "暂时没有可展示的灵感图。"}</div>
                            )}
                        </div>
                    </div>
                </div>
            </section>

            <Image.PreviewGroup
                preview={{
                    open: previewOpen,
                    current: previewIndex,
                    onOpenChange: (open) => setPreviewOpen(open),
                    onChange: (current) => setPreviewIndex(current),
                }}
            >
                <div className="hidden">
                    {previewItems.map((item) => (
                        <Image key={item.id} src={imagePreviewUrl(item.coverUrl, 960)} alt={item.title} preview={{ src: imagePreviewUrl(item.coverUrl, 1920) }} />
                    ))}
                </div>
            </Image.PreviewGroup>

            <footer className="landing-footer relative z-10 overflow-hidden px-4 pb-10 sm:px-6">
                <div className="landing-footer-shell mx-auto max-w-[1200px]">
                    <div className="landing-footer-brand min-w-0">
                        <SiteLogo logoUrl={site.logoUrl} className="landing-footer-logo bg-stone-950 dark:bg-white" />
                        <div className="landing-footer-brand-copy min-w-0">
                            <div className="landing-footer-title truncate text-base font-semibold text-stone-950 dark:text-white">{siteTitle}</div>
                            <div className="landing-footer-copyright mt-1 text-sm text-stone-500 dark:text-stone-400">{site.footerCopyright}</div>
                        </div>
                    </div>
                    <div className="landing-footer-actions">
                        <div className="landing-footer-links">
                            <div className="landing-footer-link-row landing-footer-policy-links">
                                <Link href="/announcements" className="landing-footer-link">
                                    网站公告
                                </Link>
                                <Link href={site.termsUrl || "/terms"} className="landing-footer-link">
                                    使用条款
                                </Link>
                                <Link href={site.privacyUrl || "/privacy"} className="landing-footer-link">
                                    隐私政策
                                </Link>
                            </div>
                            {friendLinks.length ? (
                                <div className="landing-footer-link-row landing-footer-friend-links">
                                    {friendLinks.map((link) => (
                                        <Link key={link.id} href={link.url} className="landing-footer-link" target={link.url.startsWith("/") ? undefined : "_blank"} rel={link.url.startsWith("/") ? undefined : "noreferrer"}>
                                            {link.label}
                                        </Link>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                        <div className="landing-footer-socials">
                            {Object.entries(site.socials)
                                .filter(([, social]) => social.enabled && social.url)
                                .map(([key, social]) => (
                                    <Link key={key} href={social.url} className="landing-footer-social" title={social.label} target={social.url.startsWith("/") ? undefined : "_blank"} rel={social.url.startsWith("/") ? undefined : "noreferrer"}>
                                        {socialIconByKey[key as SiteSocialKey]}
                                        <span className="sr-only">{social.label}</span>
                                    </Link>
                                ))}
                        </div>
                    </div>
                </div>
            </footer>

            <Modal open={authOpen} footer={null} width={740} centered destroyOnHidden onCancel={() => setAuthOpen(false)} className="landing-auth-modal">
                <div className="landing-auth-modal-shell">
                    <section className="landing-auth-modal-brand">
                        <div className="inline-flex items-center gap-3 text-stone-950 dark:text-white">
                            <SiteLogo logoUrl={site.logoUrl} className="landing-auth-brand-logo bg-stone-950 dark:bg-white" />
                            <span className="text-2xl font-semibold">{siteTitle}</span>
                        </div>
                        <div className="landing-auth-modal-copy">
                            <p className="text-sm font-medium text-cyan-700 dark:text-cyan-200">开始创作</p>
                            <h2 className="mt-3 text-3xl font-semibold leading-tight text-stone-950 dark:text-white">登录后继续创作</h2>
                            <p className="mt-4 text-sm leading-7 text-stone-500 dark:text-stone-300">进入画布，继续电商、短剧、美颜和提示词创作。</p>
                        </div>
                        <div className="landing-auth-modal-bullets grid gap-2 text-sm text-stone-600 dark:text-stone-300">
                            {["多场景视觉创作", "画布持续编辑", "灵感与提示词复用"].map((item) => (
                                <div key={item} className="flex items-center gap-2">
                                    <span className="size-1.5 rounded-full bg-cyan-300" />
                                    <span>{item}</span>
                                </div>
                            ))}
                        </div>
                    </section>
                    <div className="landing-auth-modal-form">
                        <AuthForm mode="login" variant="embedded" nextPath="/canvas" className="min-h-0 bg-transparent p-0 shadow-none" />
                    </div>
                </div>
            </Modal>
        </main>
    );
}

function siteShowcaseItemsToPrompts(items: SiteShowcaseItem[] = []): Prompt[] {
    const now = new Date().toISOString();
    return items
        .filter((item) => item.title.trim() && item.prompt.trim())
        .slice(0, 8)
        .map((item) => ({
            id: item.id,
            scope: "library" as const,
            title: item.title,
            coverUrl: item.coverUrl,
            prompt: item.prompt,
            tags: item.tags || [],
            category: item.category || "首页展示",
            preview: item.prompt,
            createdAt: now,
            updatedAt: now,
        }));
}

function prefetchRoutesAfterIdle(routes: string[], prefetch: (href: string) => void) {
    if (shouldSkipHomepagePrefetch()) return undefined;

    let cancelled = false;
    const timers: number[] = [];
    const idleWindow = window as Window & {
        requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
        cancelIdleCallback?: (handle: number) => void;
    };

    const run = () => {
        if (cancelled || document.visibilityState !== "visible") return;
        routes.forEach((route, index) => {
            const timer = window.setTimeout(
                () => {
                    if (!cancelled) prefetch(route);
                },
                450 + index * 650,
            );
            timers.push(timer);
        });
    };

    const idleId = idleWindow.requestIdleCallback?.(run, { timeout: 2400 });
    const fallbackTimer = idleId === undefined ? window.setTimeout(run, 1800) : undefined;

    return () => {
        cancelled = true;
        if (idleId !== undefined) idleWindow.cancelIdleCallback?.(idleId);
        if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
        timers.forEach((timer) => window.clearTimeout(timer));
    };
}

function shouldSkipHomepagePrefetch() {
    const nav = navigator as Navigator & {
        connection?: {
            saveData?: boolean;
            effectiveType?: string;
        };
    };
    const connection = nav.connection;
    if (connection?.saveData) return true;
    return /(^|-)2g$/i.test(connection?.effectiveType || "");
}

function SiteLogo({ logoUrl, className }: { logoUrl: string; className: string }) {
    if (logoUrl && logoUrl !== "/logo.svg") return <img src={logoUrl} alt="" className={cn(className, "shrink-0 object-contain")} referrerPolicy="no-referrer" />;
    return (
        <span
            className={cn(className, "shrink-0")}
            style={{
                mask: "url(/logo.svg) center / contain no-repeat",
                WebkitMask: "url(/logo.svg) center / contain no-repeat",
            }}
        />
    );
}
