import { describe, expect, it, vi } from "vitest";

import { createThemeTransitionCoordinator, resolveNextTheme } from "./animated-theme-toggler";

function deferred() {
    let resolve!: () => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

async function flushPromiseHandlers() {
    await Promise.resolve();
    await Promise.resolve();
}

describe("AnimatedThemeToggler transition coordination", () => {
    it("derives rapid toggles from the latest requested theme", () => {
        const firstTheme = resolveNextTheme("light");
        const secondTheme = resolveNextTheme(firstTheme);

        expect(firstTheme).toBe("dark");
        expect(secondTheme).toBe("light");
        expect(resolveNextTheme("light", "dark")).toBe("dark");
    });

    it("interrupts an in-flight transition instead of starting another one", async () => {
        const firstOwner = {};
        const secondOwner = {};
        const ready = deferred();
        const finished = deferred();
        const skipTransition = vi.fn();
        const animate = vi.fn();
        const cleanup = vi.fn();
        const applyFirstRapidToggle = vi.fn();
        const applySecondRapidToggle = vi.fn();
        const coordinator = createThemeTransitionCoordinator();
        const darkRequest = coordinator.requestTheme(firstOwner, "light", "dark");

        coordinator.track(firstOwner, { ready: ready.promise, finished: finished.promise, skipTransition }, animate, cleanup);
        const lightRequest = coordinator.requestTheme(secondOwner, "light", "light");

        expect(darkRequest?.theme).toBe("dark");
        expect(lightRequest?.theme).toBe("light");
        expect(coordinator.isLatestRequest(firstOwner, darkRequest!.id)).toBe(false);
        expect(coordinator.isLatestRequest(secondOwner, lightRequest!.id)).toBe(true);
        expect(coordinator.interrupt(applyFirstRapidToggle)).toBe(true);
        expect(coordinator.interrupt(applySecondRapidToggle)).toBe(true);
        expect(skipTransition).toHaveBeenCalledTimes(1);
        expect(applyFirstRapidToggle).toHaveBeenCalledTimes(1);
        expect(applySecondRapidToggle).toHaveBeenCalledTimes(1);

        ready.reject(new DOMException("Transition was skipped", "AbortError"));
        finished.reject(new DOMException("Transition was skipped", "AbortError"));
        await flushPromiseHandlers();

        expect(animate).not.toHaveBeenCalled();
        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(coordinator.interrupt(vi.fn())).toBe(false);
    });

    it("animates a ready transition and always cleans up after completion", async () => {
        const owner = {};
        const ready = deferred();
        const finished = deferred();
        const animate = vi.fn();
        const cleanup = vi.fn();
        const coordinator = createThemeTransitionCoordinator();

        coordinator.track(owner, { ready: ready.promise, finished: finished.promise }, animate, cleanup);
        ready.resolve();
        await flushPromiseHandlers();
        expect(animate).toHaveBeenCalledTimes(1);

        finished.resolve();
        await flushPromiseHandlers();
        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(coordinator.interrupt(vi.fn())).toBe(false);
    });

    it("invalidates an owner's delayed callback and consumes update callback rejection", async () => {
        const owner = {};
        const ready = deferred();
        const updateCallbackDone = deferred();
        const finished = deferred();
        const skipTransition = vi.fn();
        const animate = vi.fn();
        const cleanup = vi.fn();
        const coordinator = createThemeTransitionCoordinator();
        const request = coordinator.requestTheme(owner, "light", "dark");

        coordinator.track(owner, { ready: ready.promise, updateCallbackDone: updateCallbackDone.promise, finished: finished.promise, skipTransition }, animate, cleanup);
        coordinator.syncTheme(owner, "light");

        expect(coordinator.isLatestRequest(owner, request!.id)).toBe(false);
        expect(skipTransition).toHaveBeenCalledTimes(1);
        expect(cleanup).toHaveBeenCalledTimes(1);

        ready.reject(new DOMException("Transition was skipped", "AbortError"));
        updateCallbackDone.reject(new DOMException("Update callback failed", "AbortError"));
        finished.reject(new DOMException("Transition was skipped", "AbortError"));
        await flushPromiseHandlers();

        expect(animate).not.toHaveBeenCalled();
        expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it("keeps a newer request valid when the interrupted transition owner unmounts", () => {
        const transitionOwner = {};
        const latestOwner = {};
        const finished = deferred();
        const skipTransition = vi.fn();
        const cleanup = vi.fn();
        const coordinator = createThemeTransitionCoordinator();
        const firstRequest = coordinator.requestTheme(transitionOwner, "light", "dark");

        coordinator.track(transitionOwner, { finished: finished.promise, skipTransition }, vi.fn(), cleanup);
        const latestRequest = coordinator.requestTheme(latestOwner, "light", "light");
        coordinator.invalidateOwner(transitionOwner);

        expect(coordinator.isLatestRequest(transitionOwner, firstRequest!.id)).toBe(false);
        expect(coordinator.isLatestRequest(latestOwner, latestRequest!.id)).toBe(true);
        expect(skipTransition).toHaveBeenCalledTimes(1);
        expect(cleanup).toHaveBeenCalledTimes(1);
    });
});
