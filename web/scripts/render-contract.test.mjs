import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";

import { validateRenderBlueprint } from "./render-contract.mjs";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "..");
const source = readFileSync(path.join(repoRoot, "render.yaml"), "utf8");

describe("Render Blueprint contract", () => {
    it("keeps the Web, Worker, database, shared secret, health check and disk topology aligned", () => {
        expect(validateRenderBlueprint({ repoRoot })).toEqual({
            services: ["vozeb-pro", "vozeb-pro-generation-worker"],
            database: "vozeb-pro-postgres",
            environmentGroup: "vozeb-pro-runtime",
        });
    });

    it("rejects an ephemeral free Web instance", () => {
        expect(() => validateSource(source.replace("    plan: starter", "    plan: free"))).toThrow("持久盘 Web 与后台 Worker 必须使用可用的付费实例");
    });

    it("rejects a Worker that bypasses the private application boundary", () => {
        const unsafe = source.replace("      - key: NODE_OPTIONS\n        value: --max-old-space-size=128", "      - key: DATABASE_URL\n        value: postgres://leaked\n      - key: NODE_OPTIONS\n        value: --max-old-space-size=128");

        expect(() => validateSource(unsafe)).toThrow("Render Worker 不应直接持有数据库配置");
    });

    it("reports malformed environment lists as contract failures", () => {
        const blueprint = parse(source);
        blueprint.services[0].envVars = "invalid";

        expect(() => validateSource(stringify(blueprint))).toThrow("Web 与 Worker 必须引用同一运行时环境组");
    });
});

function validateSource(content) {
    return validateRenderBlueprint({ repoRoot, source: content });
}
