import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { validateComposeContracts, validateDocsComposeContracts } from "./compose-contract.mjs";
import { validateRenderBlueprint } from "./render-contract.mjs";
import { prepareStandaloneAssets } from "./standalone-assets.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(webRoot, "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const buildDistDir = ".next-production";

const protectedPaths = ["web/.data", "web/.next", `web/${buildDistDir}`, "web/node_modules", "web/tsconfig.tsbuildinfo"];

run("git", ["diff", "--check"], repoRoot, "检查空白和补丁格式");
console.log("\n> Docker Compose 结构与部署边界检查");
validateComposeContracts({ repoRoot });
validateDocsComposeContracts({ repoRoot });
console.log("\n> Render Blueprint 结构与运行边界检查");
validateRenderBlueprint({ repoRoot });
const trackedProtected = run("git", ["ls-files", ...protectedPaths], repoRoot, "检查数据库和构建产物未被跟踪", { capture: true });
if (trackedProtected.trim()) {
    fail(`以下运行时文件不应提交：\n${trackedProtected.trim()}`);
}

run(pnpm, ["audit", "--audit-level", "moderate"], webRoot, "依赖安全审计");
run(pnpm, ["run", "format:check"], webRoot, "Prettier 格式检查");
run(pnpm, ["run", "typecheck"], webRoot, "TypeScript 类型检查");
run(pnpm, ["run", "build"], webRoot, "Next.js 低内存构建", {
    env: {
        NEXT_BUILD_CPUS: "1",
        NODE_OPTIONS: process.env.NODE_OPTIONS || "--max-old-space-size=1024",
        NEXT_TELEMETRY_DISABLED: "1",
        NEXT_DIST_DIR: buildDistDir,
        NEXT_SKIP_BUILD_TYPECHECK: "1",
    },
});

try {
    const artifacts = await prepareStandaloneAssets({ webRoot, distDir: buildDistDir });
    console.log(`\n> Standalone 产物完整：${artifacts.staticFiles} 个静态文件，${artifacts.publicFiles} 个公开资源`);
} catch (error) {
    fail(`Standalone 产物不完整：${error instanceof Error ? error.message : String(error)}`);
}

console.log("\nVOZEB PRO 发布前检查通过。");
console.log("移动端发布前还需要人工打开：首页、画布、积分弹窗、图片工作台、视频工作台、管理员后台。");

function run(command, args, cwd, label, options = {}) {
    console.log(`\n> ${label}`);
    const executable = commandForPlatform(command, args);
    const result = spawnSync(executable.command, executable.args, {
        cwd,
        env: { ...process.env, ...(options.env || {}) },
        encoding: "utf8",
        stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });

    if (options.capture) {
        if (result.stdout) process.stdout.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);
    }

    if (result.error) fail(`${label} 无法启动：${result.error.message}`);
    if (result.status !== 0) fail(`${label} 失败。`);
    return result.stdout || "";
}

function commandForPlatform(command, args) {
    if (process.platform !== "win32") return { command, args };
    return {
        command: "cmd.exe",
        args: ["/d", "/s", "/c", [command, ...args].map(quoteWindowsArg).join(" ")],
    };
}

function quoteWindowsArg(value) {
    if (/^[a-zA-Z0-9_./:=@-]+$/.test(value)) return value;
    return `"${value.replaceAll('"', '\\"')}"`;
}

function fail(message) {
    console.error(`\n${message}`);
    process.exit(1);
}
