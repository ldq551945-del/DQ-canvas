import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("workspace sidebar", () => {
    it("links the desktop brand to the public home with press feedback", async () => {
        const [sidebar, styles] = await Promise.all([readFile(resolve(process.cwd(), "src/components/layout/app-sidebar.tsx"), "utf8"), readFile(resolve(process.cwd(), "src/app/styles/global-app-shell.css"), "utf8")]);

        expect(sidebar).toContain('href="/"');
        expect(sidebar).toContain("app-sidebar-home-link");
        expect(sidebar).toContain("app-sidebar-home-logo");
        expect(styles).toContain(".app-sidebar-home-link:active .app-sidebar-home-logo");
        expect(styles).toContain("transform: scale(0.9)");
    });

    it("starts collapsed and keeps scrolling without a visible scrollbar", async () => {
        const [shell, sidebar] = await Promise.all([readFile(resolve(process.cwd(), "src/components/layout/app-workspace-shell.tsx"), "utf8"), readFile(resolve(process.cwd(), "src/components/layout/app-sidebar.tsx"), "utf8")]);

        expect(shell).toContain("useState(false)");
        expect(shell).toContain("expanded={sidebarExpanded}");
        expect(sidebar).toContain('expanded ? "w-56" : "w-[72px]"');
        expect(sidebar).toContain("hide-scrollbar min-h-0 flex-1 overflow-y-auto");
        expect(sidebar).not.toContain("thin-scrollbar min-h-0 flex-1 overflow-y-auto");
    });
});
