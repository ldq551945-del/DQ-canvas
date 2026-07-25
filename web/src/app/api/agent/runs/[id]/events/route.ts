import { getCurrentUser } from "@/lib/auth/session";
import { getAgentRun } from "@/lib/server/agent-run-store";
import { getLatestCreativeRunEventId, listCreativeRunEvents } from "@/lib/server/creative-runtime-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    const run = user ? await getAgentRun((await params).id) : null;
    if (!user || !run || run.userId !== user.id) return new Response("Agent 任务不存在", { status: user ? 404 : 401 });
    const encoder = new TextEncoder();
    const requestedEventId = request.headers.get("last-event-id") || new URL(request.url).searchParams.get("lastEventId") || "";
    const lastEventId = requestedEventId || (await getLatestCreativeRunEventId(run.id, "task.retry.requested"));
    const body = new ReadableStream({
        start(controller) {
            let closed = false;
            let cursor = lastEventId;
            const close = () => {
                if (closed) return;
                closed = true;
                controller.close();
            };
            request.signal.addEventListener("abort", close, { once: true });
            void (async () => {
                const deadline = Date.now() + 60 * 60 * 1000;
                while (!closed && Date.now() < deadline) {
                    const current = await getAgentRun(run.id);
                    if (closed) return;
                    if (!current) {
                        controller.enqueue(encoder.encode(`event: run.failed\ndata: ${JSON.stringify({ message: "Agent 任务不存在" })}\n\n`));
                        close();
                        return;
                    }
                    const events = await listCreativeRunEvents(run.id, cursor);
                    for (const event of events) {
                        controller.enqueue(encoder.encode(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
                        cursor = event.id;
                    }
                    controller.enqueue(encoder.encode(`event: run.snapshot\ndata: ${JSON.stringify({ id: current.id, status: current.status, tasks: current.tasks, updatedAt: current.updatedAt })}\n\n`));
                    if (["completed", "failed", "cancelled"].includes(current.status)) {
                        close();
                        return;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                }
                close();
            })().catch(() => close());
        },
    });
    return new Response(body, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
