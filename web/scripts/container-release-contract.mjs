import { readFileSync } from "node:fs";
import path from "node:path";

const imageWorkflows = ["docker-image.yml", "docs-docker-image.yml", "rembg-docker-image.yml"];
const dockerfiles = ["Dockerfile", "docs/Dockerfile", "services/rembg/Dockerfile"];
const pinnedAction = /^[^@]+@[0-9a-f]{40}$/;

export function validateContainerReleaseContracts({ repoRoot, sources = {} }) {
    const read = (file) => sources[file] ?? readFileSync(path.join(repoRoot, file), "utf8");
    const violations = [];
    const ensure = (condition, message) => {
        if (!condition) violations.push(message);
    };

    for (const file of dockerfiles) {
        const source = read(file);
        const baseImages = source
            .split(/\r?\n/)
            .filter((line) => line.startsWith("FROM "))
            .map((line) => line.split(/\s+/)[1]);
        ensure(baseImages.length > 0, `${file}: missing base image`);
        ensure(
            baseImages.every((image) => /@sha256:[0-9a-f]{64}$/.test(image)),
            `${file}: every base image must be pinned by digest`,
        );
    }

    const dockerfile = read("Dockerfile");
    for (const file of ["Dockerfile", "docs/Dockerfile"]) {
        const source = read(file);
        ensure(
            source.includes("rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack") && source.includes("rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack"),
            `${file}: production image must remove build-only package managers`,
        );
    }
    ensure(/^# syntax=docker\/dockerfile:[^@\s]+@sha256:[0-9a-f]{64}$/m.test(dockerfile), "Dockerfile: BuildKit frontend must be pinned by digest");
    ensure(dockerfile.includes("COPY web/scripts/http-observability.mjs /app/web/scripts/http-observability.mjs"), "Dockerfile: missing HTTP observability preload");
    ensure(dockerfile.includes('CMD ["node", "--import", "file:///app/web/scripts/http-observability.mjs", "server.js"]'), "Dockerfile: production server must start with HTTP observability preload");

    for (const file of ["docker-compose.yml", "docker-compose.local.yml"]) {
        ensure(/image:\s+postgres:16-alpine@sha256:[0-9a-f]{64}/.test(read(file)), `${file}: PostgreSQL image must be pinned by digest`);
    }

    for (const name of imageWorkflows) {
        const file = `.github/workflows/${name}`;
        const source = read(file);
        ensure(source.includes('tags: ["v*", "DQ-v*"]') && !/^\s+branches:\s*\["main"\]/m.test(source), `${file}: stable images must only publish from formal tags`);
        ensure(source.includes("type=raw,value=latest,enable=${{ startsWith(github.ref, 'refs/tags/v') || startsWith(github.ref, 'refs/tags/DQ-v') }}"), `${file}: latest must only be enabled for formal tags`);
        ensure(source.includes("quality:\n    uses: ./.github/workflows/quality.yml"), `${file}: missing reusable quality gate`);
        ensure(/build:\s*\r?\n\s+needs:\s*\r?\n\s+- quality\s*\r?\n\s+- meta/.test(source), `${file}: image build must depend on quality and metadata`);
        ensure(source.includes("attestations: write"), `${file}: missing attestations permission`);
        ensure(source.includes("id-token: write"), `${file}: missing OIDC permission`);
        ensure(source.includes("provenance: mode=max"), `${file}: missing BuildKit provenance`);
        ensure(source.includes("sbom: true"), `${file}: missing BuildKit SBOM attestation`);
        ensure(source.includes("aquasecurity/trivy-action@"), `${file}: missing vulnerability gate`);
        ensure(source.includes("ignore-unfixed: true"), `${file}: vulnerability policy must distinguish actionable findings`);
        ensure(source.includes("severity: HIGH,CRITICAL"), `${file}: vulnerability gate must cover high and critical findings`);
        ensure(source.includes("./.github/actions/publish-container-evidence"), `${file}: missing immutable release evidence action`);
        ensure(source.includes("{{.Manifest.Digest}}"), `${file}: published manifest digest is not resolved`);
        validatePinnedActions({ file, source, violations });
    }

    const qualityWorkflowFile = ".github/workflows/quality.yml";
    const qualityWorkflow = read(qualityWorkflowFile);
    ensure(/^\s{2}workflow_call:\s*$/m.test(qualityWorkflow), `${qualityWorkflowFile}: missing workflow_call trigger`);
    validatePinnedActions({ file: qualityWorkflowFile, source: qualityWorkflow, violations });

    const evidenceActionFile = ".github/actions/publish-container-evidence/action.yml";
    const evidenceAction = read(evidenceActionFile);
    for (const marker of ["anchore/sbom-action@", "cosign sign --yes", "cosign verify", "actions/attest-build-provenance@", "retention-days: 90"]) {
        ensure(evidenceAction.includes(marker), `${evidenceActionFile}: missing ${marker}`);
    }
    validatePinnedActions({ file: evidenceActionFile, source: evidenceAction, violations });

    if (violations.length > 0) throw new Error(`Container release contract failed:\n- ${violations.join("\n- ")}`);
    return { dockerfiles, workflows: imageWorkflows, evidenceAction: evidenceActionFile };
}

function validatePinnedActions({ file, source, violations }) {
    const actionReferences = source
        .split(/\r?\n/)
        .map((line) => line.match(/^\s*-?\s*uses:\s*([^\s#]+)/)?.[1])
        .filter(Boolean)
        .filter((reference) => !reference.startsWith("./"));
    for (const reference of actionReferences) {
        if (!pinnedAction.test(reference)) violations.push(`${file}: action must be pinned by commit SHA (${reference})`);
    }
}
