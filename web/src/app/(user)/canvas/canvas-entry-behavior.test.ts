import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Canvas entry behavior", () => {
    it("keeps the removed Agent creation badge out of the public home", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/home-client.tsx"), "utf8");

        expect(source).not.toContain("Agent 创作入口");
        expect(source).not.toContain("landing-hero-badge");
    });

    it("keeps the canvas index open until the user chooses a project", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/(user)/canvas/page.tsx"), "utf8");

        expect(source).not.toContain("useSearchParams");
        expect(source).not.toContain("autoOpenRef");
        expect(source).not.toContain('searchParams.get("mode")');
        expect(source).toContain("router.push(`/canvas/${id}`)");
    });

    it("uses the Q brand mark for both canvas Agent entry points", async () => {
        const [topBar, panel] = await Promise.all([readFile(resolve(process.cwd(), "src/app/(user)/canvas/components/canvas-top-bar.tsx"), "utf8"), readFile(resolve(process.cwd(), "src/app/(user)/canvas/components/canvas-assistant-panel.tsx"), "utf8")]);

        expect(topBar).toContain('<span className="canvas-agent-button-icon inline-flex size-7 shrink-0 items-center justify-center">');
        expect(topBar).toContain('<SiteLogo logoUrl="/logo.svg" className={agentOpen ? "size-7 dark:bg-stone-950" : "size-7"} />');
        expect(panel).toContain('<SiteLogo logoUrl="/logo.svg" className="size-7" />');
        expect(topBar).not.toContain("<Bot");
        expect(panel).not.toContain("<Bot");
    });

    it("uses the Q brand mark across image and video workbench Agent states", async () => {
        const source = await readFile(resolve(process.cwd(), "src/components/agent/workbench-agent-panel.tsx"), "utf8");

        expect(source).toContain('import { SiteLogo } from "@/components/layout/site-logo";');
        expect(source.match(/<SiteLogo logoUrl="\/logo\.svg" className="size-7" \/>/g)).toHaveLength(2);
        expect(source).not.toContain("<Bot");
    });

    it("does not expand the Agent panel while a canvas project loads", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/(user)/canvas/[id]/use-canvas-generation-actions.tsx"), "utf8");

        expect(source).not.toContain("autoOpenedAgentRef");
        expect(source).not.toContain('matchMedia("(min-width: 1024px)")');
    });
});
