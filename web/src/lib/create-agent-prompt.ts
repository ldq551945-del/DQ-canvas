export const CREATE_AGENT_PROMPT_MAX_LENGTH = 4000;

export function createAgentPromptHref(value: string) {
    const prompt = value.trim().slice(0, CREATE_AGENT_PROMPT_MAX_LENGTH);
    if (!prompt) return "/create";
    return `/create#${new URLSearchParams({ source: "gallery", prompt })}`;
}

export function createAgentPromptFromHash(value: string) {
    const params = new URLSearchParams(value.replace(/^#/, ""));
    if (params.get("source") !== "gallery") return "";
    return (params.get("prompt") || "").trim().slice(0, CREATE_AGENT_PROMPT_MAX_LENGTH);
}
