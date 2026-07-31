import { BookMarked, Clapperboard, Compass, FileText, GalleryVerticalEnd, ImagePlus, Images, Maximize2, Sparkles, UserRound, Video } from "lucide-react";

export const navigationGroups = [
    { id: "create", label: "创作" },
    { id: "projects", label: "项目" },
    { id: "professional", label: "专业工具" },
    { id: "assets", label: "资产" },
    { id: "community", label: "社区" },
] as const;

export const landingNavigationTools = [
    { slug: "create", label: "Agent 创作" },
    { slug: "image", label: "生图工作台" },
    { slug: "drama", label: "短剧项目" },
    { slug: "gallery", label: "作品广场" },
] as const;

export const navigationTools = [
    {
        slug: "create",
        label: "创作 Agent",
        description: "统一创作入口",
        group: "create",
        icon: Sparkles,
        primary: true,
    },
    {
        slug: "canvas",
        label: "我的画布",
        description: "节点式多媒体创作",
        group: "projects",
        icon: Maximize2,
    },
    {
        slug: "drama",
        label: "短剧项目",
        description: "剧本、分镜与成片",
        group: "projects",
        icon: Clapperboard,
    },
    {
        slug: "image",
        label: "生图工作台",
        description: "图片生成与精调",
        group: "professional",
        icon: ImagePlus,
    },
    {
        slug: "video",
        label: "视频创作台",
        description: "视频生成与精调",
        group: "professional",
        icon: Video,
    },
    {
        slug: "works",
        label: "作品管理",
        description: "发布、审核与分享",
        group: "assets",
        icon: GalleryVerticalEnd,
    },
    {
        slug: "assets",
        label: "我的素材",
        description: "图片、视频与音频",
        group: "assets",
        icon: Images,
    },
    {
        slug: "my-prompts",
        label: "我的提示词",
        description: "个人提示词",
        group: "assets",
        icon: BookMarked,
    },
    {
        slug: "prompts",
        label: "提示词库",
        description: "公共提示词",
        group: "assets",
        icon: FileText,
    },
    {
        slug: "community",
        label: "作品广场",
        description: "发现公开作品",
        group: "community",
        icon: Compass,
    },
    {
        slug: "me",
        label: "个人主页",
        description: "已发布与我的喜欢",
        group: "community",
        icon: UserRound,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
export type NavigationGroupId = (typeof navigationGroups)[number]["id"];

export function navigationToolForPathname(pathname: string) {
    const slug = pathname.split("/").filter(Boolean)[0];
    return navigationTools.find((tool) => tool.slug === slug);
}
