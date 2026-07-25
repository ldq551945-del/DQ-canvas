"use client";

import { useEffect, useMemo, useState } from "react";

import type { CreativeAgentModelOption } from "@/components/agent/creative-agent-controls";
import type { AgentSkillWorkspace } from "@/lib/auth/store-types";
import { listAgentSkills, type AgentSkillSummary } from "@/services/api/agent-skills";
import { useConfigStore } from "@/stores/use-config-store";

export function useCreativeAgentModels(capabilities: CreativeAgentModelOption["capability"][] = ["image", "video", "audio"]) {
    const logicalModels = useConfigStore((state) => state.config.logicalModels);
    const capabilityKey = capabilities.join(",");
    return useMemo(() => {
        const allowed = new Set(capabilityKey.split(","));
        return logicalModels.flatMap((model) =>
            model.enabled && model.capability !== "text" && allowed.has(model.capability) && model.bindings.some((binding) => binding.enabled)
                ? [{ id: model.id, name: model.name, capability: model.capability as CreativeAgentModelOption["capability"] }]
                : [],
        );
    }, [capabilityKey, logicalModels]);
}

export function useCreativeAgentOptions(workspace: AgentSkillWorkspace, capabilities: CreativeAgentModelOption["capability"][] = ["image", "video", "audio"]) {
    const [skills, setSkills] = useState<AgentSkillSummary[]>([]);
    const [skillsLoading, setSkillsLoading] = useState(true);
    const models = useCreativeAgentModels(capabilities);

    useEffect(() => {
        let active = true;
        setSkillsLoading(true);
        void listAgentSkills(workspace)
            .then((items) => {
                if (active) setSkills(items);
            })
            .catch(() => {
                if (active) setSkills([]);
            })
            .finally(() => {
                if (active) setSkillsLoading(false);
            });
        return () => {
            active = false;
        };
    }, [workspace]);

    return { skills, skillsLoading, models };
}
