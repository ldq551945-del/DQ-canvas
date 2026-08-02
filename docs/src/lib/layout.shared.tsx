import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { appName, gitConfig } from "./shared";
import { ArrowUpRight } from "lucide-react";

const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;
const qqGroupUrl = "https://store.dqin-666zj.top/community";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="inline-flex items-center gap-2 font-semibold">
          <img src="/logo.svg" alt={appName} className="h-6 w-6" />
          <span>{appName}</span>
        </span>
      ),
    },
    links: [
      {
        text: "文档导航",
        url: "/docs/overview/quick-start",
        on: "nav",
      },
      {
        text: (
          <span className="inline-flex items-center gap-1.5">
            <span>项目仓库</span>
            <ArrowUpRight className="size-4" />
          </span>
        ),
        url: githubUrl,
        external: true,
        on: "nav",
      },
      {
        type: "icon",
        text: "GitHub",
        label: "GitHub",
        url: githubUrl,
        external: true,
        on: "menu",
        icon: <img src="/github.svg" alt="" className="size-4" />,
      },
      {
        type: "icon",
        text: "DQ 开源交流 社区",
        label: "DQ 开源交流 社区（社区入口）",
        url: qqGroupUrl,
        external: true,
        on: "menu",
        icon: <img src="/qq.svg" alt="" className="size-4" />,
      },
    ],
  };
}
