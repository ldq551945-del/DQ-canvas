import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateContainerReleaseContracts } from "./container-release-contract.mjs";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "..");

describe("container release contract", () => {
    it("keeps immutable bases, vulnerability gates, signatures and provenance aligned", () => {
        expect(validateContainerReleaseContracts({ repoRoot })).toEqual({
            dockerfiles: ["Dockerfile", "docs/Dockerfile", "services/rembg/Dockerfile"],
            workflows: ["docker-image.yml", "docs-docker-image.yml", "rembg-docker-image.yml"],
            evidenceAction: ".github/actions/publish-container-evidence/action.yml",
        });
    });

    it("rejects a production image without the HTTP observability preload", () => {
        const source = read("Dockerfile").replace("COPY web/scripts/http-observability.mjs /app/web/scripts/http-observability.mjs", "");
        expect(() => validateContainerReleaseContracts({ repoRoot, sources: { Dockerfile: source } })).toThrow("missing HTTP observability preload");
    });

    it("rejects a production image that retains build-only package managers", () => {
        const source = read("Dockerfile").replace("RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \\", "");
        expect(() => validateContainerReleaseContracts({ repoRoot, sources: { Dockerfile: source } })).toThrow("must remove build-only package managers");
    });

    it("rejects a docs runtime image that retains build-only package managers", () => {
        const file = "docs/Dockerfile";
        const source = read(file).replace("RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \\", "");
        expect(() => validateContainerReleaseContracts({ repoRoot, sources: { [file]: source } })).toThrow("docs/Dockerfile: production image must remove build-only package managers");
    });

    it("rejects floating base images", () => {
        const source = read("docs/Dockerfile").replace(/node:22-bookworm-slim@sha256:[0-9a-f]{64}/g, "node:22-bookworm-slim");
        expect(() => validateContainerReleaseContracts({ repoRoot, sources: { "docs/Dockerfile": source } })).toThrow("every base image must be pinned by digest");
    });

    it("rejects a workflow without the vulnerability gate", () => {
        const file = ".github/workflows/docker-image.yml";
        const source = read(file).replace("aquasecurity/trivy-action@", "aquasecurity/removed-action@");
        expect(() => validateContainerReleaseContracts({ repoRoot, sources: { [file]: source } })).toThrow("missing vulnerability gate");
    });

    it("rejects publishing stable images from main", () => {
        const file = ".github/workflows/docker-image.yml";
        const source = read(file).replace('tags: ["v*", "DQ-v*"]', 'branches: ["main"]');
        expect(() => validateContainerReleaseContracts({ repoRoot, sources: { [file]: source } })).toThrow("must only publish from formal tags");
    });

    it("rejects an unconditional latest tag", () => {
        const file = ".github/workflows/docs-docker-image.yml";
        const source = read(file).replace("type=raw,value=latest,enable=${{ startsWith(github.ref, 'refs/tags/v') || startsWith(github.ref, 'refs/tags/DQ-v') }}", "type=raw,value=latest");
        expect(() => validateContainerReleaseContracts({ repoRoot, sources: { [file]: source } })).toThrow("latest must only be enabled for formal tags");
    });

    it("rejects image builds that bypass the reusable quality workflow", () => {
        const file = ".github/workflows/rembg-docker-image.yml";
        const source = read(file).replace("    needs:\n      - quality\n      - meta", "    needs: meta");
        expect(() => validateContainerReleaseContracts({ repoRoot, sources: { [file]: source } })).toThrow("image build must depend on quality and metadata");
    });

    it("requires the quality workflow to be reusable", () => {
        const file = ".github/workflows/quality.yml";
        const source = read(file).replace("  workflow_call:\n", "");
        expect(() => validateContainerReleaseContracts({ repoRoot, sources: { [file]: source } })).toThrow("missing workflow_call trigger");
    });

    it("rejects tag-pinned remote actions", () => {
        const file = ".github/workflows/docs-docker-image.yml";
        const source = read(file).replace(/actions\/checkout@[0-9a-f]{40}/, "actions/checkout@v4");
        expect(() => validateContainerReleaseContracts({ repoRoot, sources: { [file]: source } })).toThrow("action must be pinned by commit SHA");
    });
});

function read(file) {
    return readFileSync(path.join(repoRoot, file), "utf8");
}
