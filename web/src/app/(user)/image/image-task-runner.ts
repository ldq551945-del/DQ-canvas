export type ImageTaskQueueOptions = {
    getConcurrencyLimit: () => number;
    isResultDeleted: (logId: string, resultId: string) => boolean;
    onActiveCountChange?: (count: number) => void;
};

export class ImageTaskQueue {
    private activeCount = 0;
    private readonly queue: Array<() => void> = [];

    constructor(private readonly options: ImageTaskQueueOptions) {}

    get activeTasks() {
        return this.activeCount;
    }

    async run<T>(logId: string, resultId: string, worker: () => Promise<T>) {
        if (this.options.isResultDeleted(logId, resultId)) return undefined;
        await this.waitForSlot();
        try {
            if (this.options.isResultDeleted(logId, resultId)) return undefined;
            return await worker();
        } finally {
            this.releaseSlot();
        }
    }

    startQueuedTasks() {
        while (this.activeCount < this.concurrencyLimit() && this.queue.length) {
            const resolve = this.queue.shift();
            if (!resolve) return;
            this.reserveSlot();
            resolve();
        }
    }

    clearQueue() {
        this.queue.length = 0;
    }

    private async waitForSlot() {
        if (this.activeCount < this.concurrencyLimit()) {
            this.reserveSlot();
            return;
        }
        await new Promise<void>((resolve) => this.queue.push(resolve));
    }

    private reserveSlot() {
        this.activeCount += 1;
        this.options.onActiveCountChange?.(this.activeCount);
    }

    private releaseSlot() {
        this.activeCount = Math.max(0, this.activeCount - 1);
        this.options.onActiveCountChange?.(this.activeCount);
        this.startQueuedTasks();
    }

    private concurrencyLimit() {
        return Math.max(1, Math.floor(Number(this.options.getConcurrencyLimit()) || 1));
    }
}

export function imageTaskControllerKey(logId: string, resultId: string, taskId: string) {
    return `${logId}:${resultId}:${taskId}`;
}

export class ImageTaskControllers {
    private readonly controllers = new Map<string, AbortController>();

    has(logId: string, resultId: string, taskId: string) {
        return this.controllers.has(imageTaskControllerKey(logId, resultId, taskId));
    }

    create(logId: string, resultId: string, taskId: string) {
        const controller = new AbortController();
        this.controllers.set(imageTaskControllerKey(logId, resultId, taskId), controller);
        return controller;
    }

    remove(logId: string, resultId: string, taskId: string) {
        this.controllers.delete(imageTaskControllerKey(logId, resultId, taskId));
    }

    abortAndRemove(logId: string, resultId: string, taskId: string) {
        const key = imageTaskControllerKey(logId, resultId, taskId);
        const controller = this.controllers.get(key);
        controller?.abort();
        this.controllers.delete(key);
        return Boolean(controller);
    }

    clear() {
        this.controllers.clear();
    }
}
