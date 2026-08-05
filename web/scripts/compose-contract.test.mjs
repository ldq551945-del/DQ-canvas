import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { composeProfiles, docsComposeProfiles, validateComposeContract, validateComposeContracts, validateDocsComposeContract, validateDocsComposeContracts } from "./compose-contract.mjs";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "..");

describe("Docker Compose contracts", () => {
    it("validates every supported deployment topology with structured YAML parsing", () => {
        expect(validateComposeContracts({ repoRoot })).toEqual(
            composeProfiles.map((profile) => ({
                file: profile.file,
                services: profile.file === "docker-compose.lowmem.yml" ? ["app", "generation-worker"] : profile.embeddedPostgres ? ["postgres", "app", "rembg", "generation-worker"] : ["app", "rembg", "generation-worker"],
            })),
        );
        expect(validateDocsComposeContracts({ repoRoot })).toEqual(docsComposeProfiles.map(({ file }) => ({ file, services: ["docs"] })));
    });

    it("rejects a Worker that can bypass the application database boundary", () => {
        const profile = composeProfiles.find(({ file }) => file === "docker-compose.external-db.yml");
        const source = readFileSync(path.join(repoRoot, profile.file), "utf8").replace("      DQ_WORKER_API_ORIGIN: http://app:3000", "      DQ_WORKER_API_ORIGIN: http://app:3000\n      DATABASE_URL: postgres://leaked");

        expect(() => validateComposeContract(source, profile)).toThrow("generation-worker 不应直接持有数据库连接串");
    });

    it("rejects Baota-only host networking in the public default topology", () => {
        const profile = composeProfiles.find(({ file }) => file === "docker-compose.yml");
        const source = readFileSync(path.join(repoRoot, profile.file), "utf8").replace("    image: ${DQ_IMAGE", "    network_mode: host\n    image: ${DQ_IMAGE");

        expect(() => validateComposeContract(source, profile)).toThrow("宝塔专用 host 网络不得泄漏到其他拓扑");
    });

    it("rejects a low-memory topology that accepts the embedded rembg default", () => {
        const profile = composeProfiles.find(({ file }) => file === "docker-compose.lowmem.yml");
        const source = readFileSync(path.join(repoRoot, profile.file), "utf8").replace("${DQ_REMBG_URL:?低内存部署请在 .env 中配置外部 rembg 服务 URL}", "${DQ_REMBG_URL:-http://rembg:7000}");

        expect(() => validateComposeContract(source, profile)).toThrow("低内存拓扑必须显式要求外部 rembg 地址");
    });

    it("requires the low-memory app health check to wait for the external rembg model", () => {
        const profile = composeProfiles.find(({ file }) => file === "docker-compose.lowmem.yml");
        const source = readFileSync(path.join(repoRoot, profile.file), "utf8").replaceAll("readyz", "status");

        expect(() => validateComposeContract(source, profile)).toThrow("低内存 app 健康检查必须验证外部 rembg 就绪");
    });

    it("requires the app to receive the same inference concurrency as the sidecar", () => {
        const profile = composeProfiles.find(({ file }) => file === "docker-compose.external-db.yml");
        const source = readFileSync(path.join(repoRoot, profile.file), "utf8").replace("DQ_REMBG_CONCURRENCY: ${DQ_REMBG_CONCURRENCY:-1}", "DQ_REMBG_CONCURRENCY: ${DQ_REMBG_CONCURRENCY:-2}");

        expect(() => validateComposeContract(source, profile)).toThrow("app 必须显式使用 rembg 并发配置");
    });

    it("requires the application to wait for the embedded rembg sidecar", () => {
        const profile = composeProfiles.find(({ file }) => file === "docker-compose.local.yml");
        const source = readFileSync(path.join(repoRoot, profile.file), "utf8").replace("      rembg:\n        condition: service_healthy\n", "");

        expect(() => validateComposeContract(source, profile)).toThrow("app 必须等待 rembg 就绪");
    });

    it("requires regular Compose and Deploy rembg resource limits to stay aligned", () => {
        const profile = composeProfiles.find(({ file }) => file === "docker-compose.external-db.yml");
        const source = readFileSync(path.join(repoRoot, profile.file), "utf8").replace('          memory: "${DQ_REMBG_MEMORY_LIMIT:-5g}"', '          memory: "1g"');

        expect(() => validateComposeContract(source, profile)).toThrow("rembg Deploy 内存上限必须与普通 Compose 一致");
    });

    it("requires the full-resolution alpha-matting tile budget", () => {
        const profile = composeProfiles.find(({ file }) => file === "docker-compose.local.yml");
        const source = readFileSync(path.join(repoRoot, profile.file), "utf8").replace(
            "DQ_REMBG_ALPHA_MATTING_TILE_PIXELS: ${DQ_REMBG_ALPHA_MATTING_TILE_PIXELS:-1048576}",
            "DQ_REMBG_ALPHA_MATTING_MAX_PIXELS: ${DQ_REMBG_ALPHA_MATTING_MAX_PIXELS:-2000000}",
        );

        expect(() => validateComposeContract(source, profile)).toThrow("rembg 必须使用原尺寸 Alpha 分块预算");
    });

    it("rejects a runtime volume that hides the models preloaded in the rembg image", () => {
        const profile = composeProfiles.find(({ file }) => file === "docker-compose.external-db.yml");
        const source = readFileSync(path.join(repoRoot, profile.file), "utf8")
            .replace('    expose:\n      - "7000"', '    volumes:\n      - dq-rembg-models:/models\n    expose:\n      - "7000"')
            .replace("volumes:\n  dq-data:", "volumes:\n  dq-data:\n  dq-rembg-models:");

        expect(() => validateComposeContract(source, profile)).toThrow("rembg 不得用运行时卷遮蔽镜像内预取模型");
    });

    it("requires the local image to preload the complete canvas model allowlist", () => {
        const profile = composeProfiles.find(({ file }) => file === "docker-compose.local.yml");
        const source = readFileSync(path.join(repoRoot, profile.file), "utf8").replace("DQ_REMBG_MODELS: u2net,isnet-general-use,u2net_human_seg,isnet-anime,silueta", "DQ_REMBG_MODELS: u2net");

        expect(() => validateComposeContract(source, profile)).toThrow("本地 rembg 构建必须预取完整画布模型白名单");
    });

    it("keeps the published rembg allowlist in the image instead of an overridable volume", () => {
        const dockerfile = readFileSync(path.join(repoRoot, "services/rembg/Dockerfile"), "utf8");

        expect(dockerfile).toContain("ARG DQ_REMBG_MODELS=u2net,isnet-general-use,u2net_human_seg,isnet-anime,silueta");
        expect(dockerfile).toContain("sessions[name].download_models()");
        expect(dockerfile).not.toContain('VOLUME ["/models"]');
    });

    it("reports an invalid docs service shape as a contract failure", () => {
        const profile = docsComposeProfiles[0];

        expect(() => validateDocsComposeContract("services: invalid", profile)).toThrow("文档 Compose 必须且只能声明 docs 服务");
    });
});
