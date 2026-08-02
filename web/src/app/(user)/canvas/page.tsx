"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button } from "antd";
import { Download, FileUp, Plus } from "lucide-react";

import { readZip } from "@/lib/zip";
import { APP_EXPORT_ID } from "@/lib/storage-keys";
import { uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { CanvasDeleteProjectsDialog } from "./components/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "./components/canvas-project-card";
import type { CanvasExportFile } from "./export-types";
import { useCanvasStore } from "./stores/use-canvas-store";
import { useCanvasUiStore } from "./stores/use-canvas-ui-store";
import { useUserStore } from "@/stores/use-user-store";
import { exportCanvasProjects, remapImportedProjectMedia } from "./utils/canvas-export";

export default function CanvasPage() {
    const { message } = App.useApp();
    const router = useRouter();
    const inputRef = useRef<HTMLInputElement>(null);
    const [creating, setCreating] = useState(false);
    const [exporting, setExporting] = useState(false);
    const userId = useUserStore((state) => state.user?.id || "");
    const hydrated = useCanvasStore((state) => state.hydrated);
    const hydratedUserId = useCanvasStore((state) => state.hydratedUserId);
    const syncError = useCanvasStore((state) => state.syncError);
    const hydrate = useCanvasStore((state) => state.hydrate);
    const projects = useCanvasStore((state) => state.summaries);
    const loadProject = useCanvasStore((state) => state.loadProject);
    const createProject = useCanvasStore((state) => state.createProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const ready = Boolean(userId && hydrated && hydratedUserId === userId);

    const enterProject = (id: string) => {
        router.push(`/canvas/${id}`);
    };
    const createAndEnter = async () => {
        if (creating) return;
        setCreating(true);
        try {
            enterProject(await createProject(`DQ-绘图 画布 ${projects.length + 1}`));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "画布创建失败");
        } finally {
            setCreating(false);
        }
    };
    const importCanvas = async (file?: File) => {
        if (!file) return;
        try {
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("missing projects.json");
            const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
            if (data.app !== APP_EXPORT_ID) throw new Error("不是当前应用的画布包");
            await Promise.all(
                data.projects.map(async (item) => {
                    const uploaded = new Map<string, { storageKey: string; url: string }>();
                    await Promise.all(
                        item.files.map(async (file) => {
                            const blob = zip.get(file.path);
                            if (!blob) return;
                            const typedBlob = blob.type ? blob : blob.slice(0, blob.size, file.mimeType);
                            const media = file.mimeType.startsWith("image/") ? await uploadImage(typedBlob) : await uploadMediaFile(typedBlob, file.mimeType.startsWith("audio/") ? "audio" : "video");
                            uploaded.set(file.storageKey, media);
                        }),
                    );
                    await importProject(remapImportedProjectMedia(item.project, uploaded));
                }),
            );
            message.success(`已导入 ${data.projects.length} 个画布`);
        } catch {
            message.error("导入失败，请选择有效的画布压缩包");
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };
    const exportSelectedProjects = async () => {
        if (!selectedIds.length || exporting) return;
        setExporting(true);
        try {
            const selected = await Promise.all(selectedIds.map((id) => loadProject(id)));
            await exportCanvasProjects(selected);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "画布导出失败");
        } finally {
            setExporting(false);
        }
    };

    useEffect(() => {
        void hydrate();
    }, [hydrate, userId]);

    return (
        <main className="h-full overflow-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-2 py-2 sm:gap-6 sm:px-6 sm:py-8">
                <header className="flex flex-wrap items-end justify-between gap-2.5 border-b border-border pb-3 sm:gap-4 sm:pb-5">
                    <div>
                        <p className="text-xs text-stone-500">画布库</p>
                        <h1 className="mt-1 text-xl font-semibold sm:mt-2 sm:text-2xl">我的画布</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        {selectedIds.length ? (
                            <>
                                <Button disabled={!ready} loading={exporting} icon={<Download className="size-4" />} onClick={() => void exportSelectedProjects()}>
                                    导出选中
                                </Button>
                                <Button disabled={!ready} onClick={() => setDeleteIds(selectedIds)}>
                                    删除选中
                                </Button>
                            </>
                        ) : null}
                        {projects.length ? (
                            <Button disabled={!ready} onClick={() => setDeleteIds(projects.map((project) => project.id))}>
                                删除全部
                            </Button>
                        ) : null}
                        <Button disabled={!ready} icon={<FileUp className="size-4" />} onClick={() => inputRef.current?.click()}>
                            导入画布
                        </Button>
                        <Button disabled={!ready} loading={creating} type="primary" icon={<Plus className="size-4" />} onClick={() => void createAndEnter()}>
                            新建画布
                        </Button>
                    </div>
                </header>

                {!ready ? (
                    <section className="flex min-h-24 flex-col items-center justify-center gap-3 border-y border-stone-200 px-4 text-center text-sm text-stone-500 sm:min-h-48 dark:border-stone-800">
                        <span>{syncError || "正在加载画布..."}</span>
                        {syncError ? (
                            <Button size="small" onClick={() => void hydrate(true)}>
                                重新加载
                            </Button>
                        ) : null}
                    </section>
                ) : projects.length ? (
                    <div className="grid gap-2 sm:grid-cols-2 sm:gap-5 xl:grid-cols-3">
                        {projects.map((project) => (
                            <CanvasProjectCard key={project.id} project={project} />
                        ))}
                    </div>
                ) : (
                    <section className="flex min-h-24 flex-col items-center justify-center border-y border-stone-200 px-3 py-5 text-center sm:min-h-56 sm:py-8 dark:border-stone-800">
                        <h2 className="text-lg font-medium sm:text-xl">还没有画布</h2>
                        <p className="mt-1.5 text-xs text-stone-500 sm:mt-3 sm:text-sm">新建一个画布后，就可以独立保存节点、连线和画布外观。</p>
                        <Button type="primary" size="small" className="mt-3 sm:mt-5" loading={creating} icon={<Plus className="size-4" />} onClick={() => void createAndEnter()}>
                            新建画布
                        </Button>
                    </section>
                )}
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <CanvasDeleteProjectsDialog />
        </main>
    );
}
