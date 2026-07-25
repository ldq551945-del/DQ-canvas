import { refundUserPoints } from "@/lib/auth/store";
import { getAudioTask, transitionAudioTask, type AudioTask } from "@/lib/server/audio-task-store";
import { generationModelId } from "@/lib/server/generation-channel";

export async function refundAudioTask(task: AudioTask) {
    const billing = task.billing;
    if ((task.status !== "error" && task.status !== "cancelled") || !billing?.pointsCost || !billing.pointsRecordId || billing.refunded) return task;

    await refundUserPoints(task.userId, generationModelId(task.config), billing.pointsCost, "audio", 1, audioTaskRefundIdempotencyKey(task), billing.pointsRecordId);
    return (
        (await transitionAudioTask(task, [task.status], {
            status: task.status,
            billing: { ...billing, refunded: true },
        })) ||
        (await getAudioTask(task.id)) ||
        task
    );
}

export function audioTaskRefundIdempotencyKey(task: Pick<AudioTask, "id" | "attemptNo">) {
    return task.attemptNo === undefined ? `audio-task:${task.id}` : `audio-task:${task.id}:attempt:${task.attemptNo}`;
}
