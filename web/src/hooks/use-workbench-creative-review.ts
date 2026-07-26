"use client";

import { useEffect, useRef } from "react";

import type { WorkbenchCreativeReviewContext } from "@/hooks/use-workbench-agent-run";
import type { CreativeReview } from "@/lib/creative-agent-contract";
import { reviewWorkbenchCreativeOutput } from "@/services/api/creative-review";

export function useWorkbenchCreativeReview(input: { workspace: "image" | "video"; recordId?: string; completed: boolean; reviewContext: WorkbenchCreativeReviewContext | null; assets: Array<{ id: string; url: string }> }) {
    const requested = useRef(new Set<string>());
    const reviews = useRef(new Map<string, CreativeReview>());
    const assetsRef = useRef(input.assets);
    assetsRef.current = input.assets;
    const assetKey = input.assets.map((item) => `${item.id}:${item.url.slice(0, 80)}`).join("|");
    useEffect(() => {
        const context = input.reviewContext;
        if (!input.recordId || !input.completed || !context || context.recordId !== input.recordId) return;
        const key = input.recordId;
        if (requested.current.has(key)) return;
        requested.current.add(key);
        void reviewWorkbenchCreativeOutput({ recordId: input.recordId, workspace: input.workspace, foundation: context.foundation, deliverables: context.deliverables, assets: assetsRef.current })
            .then((review) => reviews.current.set(key, review))
            .catch(() => undefined);
    }, [assetKey, input.completed, input.recordId, input.reviewContext, input.workspace]);
}
