import { selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";

export function selectVideoModel(config: AiConfig, options = selectableModelsByCapability(config, "video"), preferred?: unknown) {
    const candidates = [preferred, config.videoModel, config.model, options[0]].map((value) => (typeof value === "string" || typeof value === "number" ? String(value).trim() : "")).filter(Boolean);
    return candidates.find((candidate) => options.includes(candidate)) || "";
}
