import { describe, expect, it } from "vitest";

import { CREATE_AGENT_PROMPT_MAX_LENGTH, createAgentPromptFromHash, createAgentPromptHref } from "./create-agent-prompt";

describe("Agent prompt handoff", () => {
    it("round-trips a gallery prompt through a create-page fragment", () => {
        const href = createAgentPromptHref("  生成一只阳光下的中华田园犬  ");

        expect(href).toMatch(/^\/create#/);
        expect(createAgentPromptFromHash(href.slice(href.indexOf("#")))).toBe("生成一只阳光下的中华田园犬");
    });

    it("ignores unrelated fragments and enforces the Agent input limit", () => {
        expect(createAgentPromptFromHash("#source=other&prompt=忽略")).toBe("");
        expect(createAgentPromptFromHash(createAgentPromptHref("图".repeat(CREATE_AGENT_PROMPT_MAX_LENGTH + 10)).split("#")[1])).toHaveLength(CREATE_AGENT_PROMPT_MAX_LENGTH);
    });
});
