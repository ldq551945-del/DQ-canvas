export function resolveDramaShotDuration(value: unknown, defaultSeconds: number) {
    const requested = Number(value);
    const seconds = Number.isFinite(requested) && requested > 0 ? requested : defaultSeconds;
    return Math.max(1, Math.min(20, Math.round(seconds)));
}
