import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skipTypeCheck = process.env.NEXT_SKIP_BUILD_TYPECHECK === "1";

if (!skipTypeCheck) {
    runNode(path.join(webRoot, "node_modules/typescript/bin/tsc"), ["--noEmit", "--pretty", "false"], "TypeScript 类型检查");
}

runNode(path.join(webRoot, "node_modules/next/dist/bin/next"), ["build", ...process.argv.slice(2)], "Next.js production 构建", {
    NEXT_SKIP_BUILD_TYPECHECK: "1",
});

function runNode(entry, args, label, environment = {}) {
    console.log("\n> " + label);
    const result = spawnSync(process.execPath, [entry, ...args], {
        cwd: webRoot,
        env: { ...process.env, ...environment },
        stdio: "inherit",
    });

    if (result.error) {
        console.error(label + "无法启动：" + result.error.message);
        process.exit(1);
    }
    if (result.status !== 0) process.exit(result.status || 1);
}
