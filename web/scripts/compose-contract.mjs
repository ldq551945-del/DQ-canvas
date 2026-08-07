import { readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "yaml";

export const composeProfiles = [
    { file: "docker-compose.yml", embeddedPostgres: true, workerOrigin: "http://app:3000" },
    { file: "docker-compose.local.yml", embeddedPostgres: true, workerOrigin: "http://app:3000" },
    { file: "docker-compose.baota.yml", embeddedPostgres: false, hostNetwork: true, workerOrigin: "http://127.0.0.1:3000" },
    { file: "docker-compose.external-db.yml", embeddedPostgres: false, workerOrigin: "http://app:3000" },
    { file: "docker-compose.lowmem.yml", embeddedPostgres: false, workerOrigin: "http://app:3000" },
];

export const docsComposeProfiles = [
    { file: "docs/docker-compose.yml", image: "${DQ_DOCS_IMAGE:-ghcr.io/dao-qin/dq-docs:latest}" },
    { file: "docs/docker-compose.local.yml", build: { context: "..", dockerfile: "docs/Dockerfile" } },
];

const maintenanceToken = "${DQ_MAINTENANCE_TOKEN:?请在 .env 中配置至少 32 位维护令牌}";
const installToken = "${DQ_INSTALL_TOKEN:-}";
const allowedWorkerEnvironmentKeys = new Set([
    "NODE_OPTIONS",
    "DQ_WORKER_API_ORIGIN",
    "DQ_WORKER_TOKEN",
    "DQ_GENERATION_WORKER_ID",
    "DQ_GENERATION_WORKER_INTERVAL_MS",
    "DQ_GENERATION_WORKER_LANES",
    "DQ_GENERATION_WORKER_HEARTBEAT_MS",
    "DQ_BILLING_REFUND_WORKER_INTERVAL_MS",
]);
const rembgCpus = "${DQ_REMBG_CPUS:-2.0}";
const rembgMemoryLimit = "${DQ_REMBG_MEMORY_LIMIT:-5g}";
const rembgCanvasModels = "u2net,isnet-general-use,u2net_human_seg,isnet-anime,silueta";

export function validateComposeContracts({ repoRoot }) {
    return composeProfiles.map((profile) => {
        const source = readFileSync(path.join(repoRoot, profile.file), "utf8");
        return validateComposeContract(source, profile);
    });
}

export function validateDocsComposeContracts({ repoRoot }) {
    return docsComposeProfiles.map((profile) => {
        const source = readFileSync(path.join(repoRoot, profile.file), "utf8");
        return validateDocsComposeContract(source, profile);
    });
}

export function validateDocsComposeContract(source, profile) {
    let compose;
    try {
        compose = parse(source);
    } catch (error) {
        throw new Error(`${profile.file}: YAML 解析失败：${error.message}`);
    }
    const services = compose?.services && typeof compose.services === "object" && !Array.isArray(compose.services) ? compose.services : {};
    const docs = services.docs;
    const violations = [];
    if (!docs || Object.keys(services).length !== 1) violations.push("文档 Compose 必须且只能声明 docs 服务");
    if (!docs?.ports?.includes("3001:3000")) violations.push("docs 必须把宿主机 3001 映射到容器 3000");
    if (docs?.restart !== "unless-stopped") violations.push("docs 必须使用 unless-stopped 重启策略");
    if (profile.image && docs?.image !== profile.image) violations.push("发布文档 Compose 镜像不正确");
    if (profile.build && (docs?.build?.context !== profile.build.context || docs?.build?.dockerfile !== profile.build.dockerfile)) violations.push("本地文档 Compose 构建上下文不正确");
    if (violations.length > 0) throw new Error(`${profile.file} Compose 契约失败：\n- ${violations.join("\n- ")}`);
    return { file: profile.file, services: ["docs"] };
}

export function validateComposeContract(source, profile) {
    let compose;
    try {
        compose = parse(source);
    } catch (error) {
        throw new Error(`${profile.file}: YAML 解析失败：${error.message}`);
    }

    const violations = [];
    const ensure = (condition, message) => {
        if (!condition) violations.push(message);
    };
    const services = compose?.services || {};
    const app = services.app || {};
    const rembg = services.rembg || {};
    const worker = services["generation-worker"] || {};
    const appEnvironment = app.environment || {};
    const rembgEnvironment = rembg.environment || {};
    const workerEnvironment = worker.environment || {};

    ensure(Boolean(services.app), "缺少 app 服务");
    ensure(Boolean(services["generation-worker"]), "缺少 generation-worker 服务");
    ensure(sameImage(app.image, worker.image), "app 与 generation-worker 必须使用同一镜像");
    ensure(JSON.stringify(worker.command) === JSON.stringify(["node", "/app/web/scripts/generation-worker.mjs"]), "Worker 启动命令不正确");
    ensure(app.env_file?.includes(".env"), "app 必须读取 .env");
    ensure(!worker.env_file, "generation-worker 禁止读取完整 .env");
    ensure(appEnvironment.DQ_MAINTENANCE_TOKEN === maintenanceToken, "app 未声明强制维护令牌");
    ensure(appEnvironment.DQ_WORKER_TOKEN === "${DQ_WORKER_TOKEN:?请在 .env 中配置至少 32 位独立 Worker 令牌}", "app 未声明独立 Worker 令牌");
    ensure(appEnvironment.DQ_INSTALL_TOKEN === installToken, "app 未声明可移除的一次性安装令牌");
    ensure(workerEnvironment.DQ_WORKER_TOKEN === "${DQ_WORKER_TOKEN:?请在 .env 中配置至少 32 位独立 Worker 令牌}", "generation-worker 未声明独立 Worker 令牌");
    ensure(!("DQ_MAINTENANCE_TOKEN" in workerEnvironment), "generation-worker 不应持有外部维护令牌");
    ensure(workerEnvironment.DQ_WORKER_API_ORIGIN === profile.workerOrigin, `Worker API 地址必须为 ${profile.workerOrigin}`);
    ensure(
        Object.keys(workerEnvironment).every((key) => allowedWorkerEnvironmentKeys.has(key)),
        "generation-worker 环境变量超出最小权限白名单",
    );
    for (const key of ["DQ_GENERATION_WORKER_ID", "DQ_GENERATION_WORKER_INTERVAL_MS", "DQ_GENERATION_WORKER_LANES", "DQ_GENERATION_WORKER_HEARTBEAT_MS", "DQ_BILLING_REFUND_WORKER_INTERVAL_MS"]) {
        ensure(key in workerEnvironment, `generation-worker 缺少显式运行参数 ${key}`);
    }
    ensure(appEnvironment.DQ_DATABASE_PROVIDER === "postgres", "app 必须使用 PostgreSQL provider");
    ensure(typeof appEnvironment.DATABASE_URL === "string", "app 缺少 DATABASE_URL");
    ensure(appEnvironment.DQ_REMBG_MODEL === "${DQ_REMBG_MODEL:-silueta}", "app 必须显式使用 rembg 模型配置");
    ensure(appEnvironment.DQ_REMBG_CONCURRENCY === "${DQ_REMBG_CONCURRENCY:-1}", "app 必须显式使用 rembg 并发配置");
    ensure(appEnvironment.DQ_REMBG_TIMEOUT_SECONDS === "${DQ_REMBG_TIMEOUT_SECONDS:-120}", "app 必须显式使用 rembg 超时配置");
    ensure(!("DATABASE_URL" in workerEnvironment), "generation-worker 不应直接持有数据库连接串");
    ensure(!("DQ_DATABASE_PROVIDER" in workerEnvironment), "generation-worker 不应直接访问数据库 provider");
    ensure(!("DQ_INSTALL_TOKEN" in workerEnvironment), "generation-worker 不应持有一次性安装令牌");
    ensure(app.volumes?.includes("dq-data:/app/web/.data"), "app 缺少持久数据卷挂载");
    ensure(Object.hasOwn(compose?.volumes || {}, "dq-data"), "缺少 dq-data 顶层数据卷");
    ensure(
        app.healthcheck?.test?.some((value) => String(value).includes("/api/health/live")),
        "app 健康检查必须调用 /api/health/live",
    );
    ensure(worker.depends_on?.app?.condition === "service_healthy", "generation-worker 必须等待 app 健康");

    if (profile.embeddedPostgres) {
        ensure(Boolean(services.postgres), "默认或本地拓扑必须包含 PostgreSQL 服务");
        ensure(String(appEnvironment.DATABASE_URL || "").includes("@postgres:5432/"), "内置 PostgreSQL 拓扑必须连接 postgres 服务");
        ensure(Object.hasOwn(compose?.volumes || {}, "dq-postgres"), "内置 PostgreSQL 拓扑缺少数据库数据卷");
    } else {
        ensure(!services.postgres, "外部数据库拓扑不得内置 PostgreSQL 服务");
        ensure(String(appEnvironment.DATABASE_URL || "").startsWith("${DATABASE_URL:?"), "外部数据库拓扑必须显式要求 DATABASE_URL");
        ensure(!Object.hasOwn(compose?.volumes || {}, "dq-postgres"), "外部数据库拓扑不得声明无用的 PostgreSQL 数据卷");
    }

    if (profile.hostNetwork) {
        ensure(app.network_mode === "host", "宝塔 app 必须使用 host 网络");
        ensure(worker.network_mode === "host", "宝塔 generation-worker 必须使用 host 网络");
        ensure("DQ_TRUSTED_PROXY_HOPS" in appEnvironment, "宝塔拓扑缺少反向代理层数配置");
        ensure(appEnvironment.DQ_REMBG_URL === "${DQ_REMBG_URL:-http://127.0.0.1:7000}", "宝塔 rembg 必须通过宿主机回环地址访问");
    } else {
        ensure(!app.network_mode && !worker.network_mode, "宝塔专用 host 网络不得泄漏到其他拓扑");
        ensure(!("DQ_TRUSTED_PROXY_HOPS" in appEnvironment), "宝塔专用反向代理默认值不得泄漏到其他拓扑");
    }

    if (profile.file === "docker-compose.lowmem.yml") {
        ensure(!services.rembg, "低内存拓扑不得内置 rembg 服务");
        ensure(appEnvironment.DQ_REMBG_URL === "${DQ_REMBG_URL:?低内存部署请在 .env 中配置外部 rembg 服务 URL}", "低内存拓扑必须显式要求外部 rembg 地址");
        ensure(
            app.healthcheck?.test?.some((value) => String(value).includes("DQ_REMBG_URL") && String(value).includes("/readyz")),
            "低内存 app 健康检查必须验证外部 rembg 就绪",
        );
    } else {
        ensure(Boolean(services.rembg), "标准、宝塔和外部数据库拓扑必须包含 rembg 服务");
        ensure(app.depends_on?.rembg?.condition === "service_healthy", "app 必须等待 rembg 就绪");
        ensure(rembg.env_file?.includes(".env"), "rembg 必须读取 .env");
        ensure(rembgEnvironment.DQ_REMBG_MODEL === appEnvironment.DQ_REMBG_MODEL, "app 与 rembg 必须使用相同模型配置");
        ensure(rembgEnvironment.DQ_REMBG_CONCURRENCY === appEnvironment.DQ_REMBG_CONCURRENCY, "app 与 rembg 必须使用相同并发配置");
        ensure(rembgEnvironment.DQ_REMBG_TIMEOUT_SECONDS === appEnvironment.DQ_REMBG_TIMEOUT_SECONDS, "app 与 rembg 必须使用相同超时配置");
        ensure(rembgEnvironment.DQ_REMBG_ALPHA_MATTING_TILE_PIXELS === "${DQ_REMBG_ALPHA_MATTING_TILE_PIXELS:-1048576}", "rembg 必须使用原尺寸 Alpha 分块预算");
        ensure(!("DQ_REMBG_ALPHA_MATTING_MAX_PIXELS" in rembgEnvironment), "rembg 不得继续使用整图缩放 Alpha 预算");
        ensure(rembg.cpus === rembgCpus, "rembg 普通 Compose CPU 上限必须使用统一配置");
        ensure(rembg.mem_limit === rembgMemoryLimit, "rembg 普通 Compose 内存上限必须使用统一配置");
        ensure(rembg.deploy?.resources?.limits?.cpus === rembgCpus, "rembg Deploy CPU 上限必须与普通 Compose 一致");
        ensure(rembg.deploy?.resources?.limits?.memory === rembgMemoryLimit, "rembg Deploy 内存上限必须与普通 Compose 一致");
        ensure(rembgEnvironment.DQ_REMBG_OMP_NUM_THREADS === "${DQ_REMBG_OMP_NUM_THREADS:-2}", "rembg 必须允许单任务使用两个 CPU 线程");
        ensure(rembgEnvironment.DQ_REMBG_ONNX_INTER_OP_THREADS === "${DQ_REMBG_ONNX_INTER_OP_THREADS:-1}", "rembg ONNX inter-op 线程必须固定为 1");
        ensure(rembgEnvironment.OMP_NUM_THREADS === rembgEnvironment.DQ_REMBG_OMP_NUM_THREADS, "rembg OpenMP 与 ONNX 线程配置必须一致");
        ensure(rembgEnvironment.OPENBLAS_NUM_THREADS === rembgEnvironment.DQ_REMBG_OMP_NUM_THREADS, "rembg OpenBLAS 与 ONNX 线程配置必须一致");
        ensure(rembgEnvironment.MKL_NUM_THREADS === rembgEnvironment.DQ_REMBG_OMP_NUM_THREADS, "rembg MKL 与 ONNX 线程配置必须一致");
        ensure(!rembg.volumes?.some((volume) => String(volume).split(":").slice(1).includes("/models")), "rembg 不得用运行时卷遮蔽镜像内预取模型");
        ensure(!Object.hasOwn(compose?.volumes || {}, "dq-rembg-models"), "不得声明会遮蔽镜像模型的 rembg 卷");
        ensure(
            rembg.healthcheck?.test?.some((value) => String(value).includes("/readyz")),
            "rembg 健康检查必须验证模型就绪",
        );
        if (profile.file === "docker-compose.local.yml") ensure(rembg.build?.args?.DQ_REMBG_MODELS === rembgCanvasModels, "本地 rembg 构建必须预取完整画布模型白名单");
        if (!profile.hostNetwork) ensure(appEnvironment.DQ_REMBG_URL === "${DQ_REMBG_URL:-http://rembg:7000}", "Compose rembg 必须通过服务名访问");
    }

    if (violations.length > 0) throw new Error(`${profile.file} Compose 契约失败：\n- ${violations.join("\n- ")}`);
    return { file: profile.file, services: Object.keys(services) };
}

function sameImage(appImage, workerImage) {
    return typeof appImage === "string" && appImage === workerImage;
}
