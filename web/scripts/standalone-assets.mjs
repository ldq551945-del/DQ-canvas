import { createRequire } from "node:module";
import { cp, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";

export async function prepareStandaloneAssets({ webRoot, distDir = ".next" }) {
    const buildRoot = resolveChildPath(webRoot, distDir, "build directory");
    const standaloneRoot = path.join(buildRoot, "standalone");
    const serverEntry = path.join(standaloneRoot, "server.js");
    const sourceStatic = path.join(buildRoot, "static");
    const targetStatic = path.join(standaloneRoot, distDir, "static");
    const sourcePublic = path.join(webRoot, "public");
    const targetPublic = path.join(standaloneRoot, "public");

    await assertFile(serverEntry, `Standalone server was not found: ${serverEntry}`);
    const sharpPackages = await copySharpRuntimePackages({ webRoot, standaloneRoot });
    const sourceStaticFiles = await listRelativeFiles(sourceStatic);
    if (!sourceStaticFiles.length) throw new Error(`Build static directory is empty: ${sourceStatic}`);

    const sourcePublicFiles = await listRelativeFiles(sourcePublic);
    for (const requiredAsset of ["logo.svg", "icon.svg"]) {
        if (!sourcePublicFiles.includes(requiredAsset)) throw new Error(`Required brand asset is missing: public/${requiredAsset}`);
    }

    await copyDirectoryContents(sourceStatic, targetStatic);
    await copyDirectoryContents(sourcePublic, targetPublic);

    const targetStaticFiles = await listRelativeFiles(targetStatic);
    const targetPublicFiles = await listRelativeFiles(targetPublic);
    if (!targetStaticFiles.length) throw new Error(`Standalone static directory is empty: ${targetStatic}`);
    const missingPublicFiles = sourcePublicFiles.filter((file) => !targetPublicFiles.includes(file));
    if (missingPublicFiles.length) throw new Error(`Standalone public directory is incomplete: ${missingPublicFiles.join(", ")}`);

    return { serverEntry, standaloneRoot, sharpPackages, staticFiles: targetStaticFiles.length, publicFiles: targetPublicFiles.length };
}

export function validateStandaloneSharpRuntime(serverEntry) {
    try {
        const sharp = createRequire(serverEntry)("sharp");
        if (!sharp?.versions?.sharp) throw new Error("Sharp version metadata is unavailable");
        return sharp.versions.sharp;
    } catch (error) {
        throw new Error(`Standalone Sharp runtime is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function assertFile(target, message) {
    try {
        if (!(await stat(target)).isFile()) throw new Error(message);
    } catch {
        throw new Error(message);
    }
}

async function copyDirectoryContents(source, target) {
    await mkdir(target, { recursive: true });
    const entries = await readdir(source, { withFileTypes: true });
    await Promise.all(entries.map((entry) => cp(path.join(source, entry.name), path.join(target, entry.name), { recursive: true, force: true })));
}

async function copySharpRuntimePackages({ webRoot, standaloneRoot }) {
    const sourcePnpmRoot = path.join(webRoot, "node_modules", ".pnpm");
    const targetPnpmRoot = path.join(standaloneRoot, "node_modules", ".pnpm");
    const packages = (await readdir(sourcePnpmRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("@img+sharp-"))
        .map((entry) => entry.name)
        .sort();
    if (!packages.length) throw new Error(`Sharp native runtime packages were not found: ${sourcePnpmRoot}`);

    await mkdir(targetPnpmRoot, { recursive: true });
    await Promise.all(packages.map((name) => cp(path.join(sourcePnpmRoot, name), path.join(targetPnpmRoot, name), { recursive: true, force: true })));
    return packages;
}

async function listRelativeFiles(root, current = root) {
    const entries = await readdir(current, { withFileTypes: true });
    const files = await Promise.all(
        entries.map(async (entry) => {
            const target = path.join(current, entry.name);
            if (entry.isDirectory()) return listRelativeFiles(root, target);
            return entry.isFile() ? [path.relative(root, target).replaceAll(path.sep, "/")] : [];
        }),
    );
    return files.flat().sort();
}

function resolveChildPath(root, child, label) {
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(resolvedRoot, child);
    if (resolved === resolvedRoot || !resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`Invalid ${label}: ${child}`);
    return resolved;
}
