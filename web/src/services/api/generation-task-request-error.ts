export class GenerationTaskRequestError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
        this.name = "GenerationTaskRequestError";
    }
}

export function isGenerationCapacityError(error: unknown) {
    return error instanceof GenerationTaskRequestError ? error.status === 429 : error instanceof Error && /并发上限|请求过于频繁/.test(error.message);
}
