import type { CreativeDeliverableSummary, CreativeFoundation, CreativeReview } from "@/lib/creative-agent-contract";

export async function reviewWorkbenchCreativeOutput(input: { workspace: "image" | "video"; foundation: CreativeFoundation; deliverables: CreativeDeliverableSummary[]; assets: Array<{ id: string; url: string }> }) {
    const response = await fetch("/api/agent/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const payload = (await response.json().catch(() => ({}))) as { data?: { review?: CreativeReview }; msg?: string };
    if (!response.ok || !payload.data?.review) throw new Error(payload.msg || "自动复盘失败");
    return payload.data.review;
}
