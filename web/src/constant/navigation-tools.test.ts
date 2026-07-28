import { describe, expect, it } from "vitest";

import { navigationGroups, navigationTools } from "./navigation-tools";

describe("user navigation order", () => {
    it("keeps published works and personal assets in the requested asset order", () => {
        expect(navigationGroups.map((group) => group.label)).toEqual(["创作", "项目", "专业工具", "资产", "社区"]);
        expect(navigationTools.filter((tool) => tool.group === "assets").map((tool) => tool.label)).toEqual(["作品管理", "我的素材", "我的提示词", "提示词库"]);
        expect(navigationTools.filter((tool) => tool.group === "community").map((tool) => tool.label)).toEqual(["作品广场", "个人主页"]);
        expect(navigationTools.find((tool) => tool.group === "community")?.slug).toBe("community");
    });
});
