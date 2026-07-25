"use client";

import { App, Button, Popconfirm, Tag } from "antd";
import { Clapperboard, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import type { DramaProjectSummary } from "../types";
import { useDramaStore } from "../stores/use-drama-store";

export function DramaProjectCard({ project }: { project: DramaProjectSummary }) {
    const router = useRouter();
    const { message } = App.useApp();
    const deleteProject = useDramaStore((state) => state.deleteProject);
    const pendingCount = project.pendingTaskCount;
    const failedCount = project.failedTaskCount;
    return (
        <article className="rounded-lg border border-border bg-card p-3 text-card-foreground transition hover:border-foreground/20 hover:shadow-sm sm:p-4">
            <div className="flex min-w-0 items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-foreground text-background">
                    <Clapperboard className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                    <h2 className="truncate text-base font-semibold sm:text-[17px]">{project.title}</h2>
                    <p className="mt-0.5 line-clamp-1 text-xs leading-5 text-muted-foreground">{project.summary || "还没有填写项目简介"}</p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                    {pendingCount ? (
                        <Tag color="processing" className="m-0">
                            {pendingCount} 执行中
                        </Tag>
                    ) : null}
                    {failedCount ? (
                        <Tag color="error" className="m-0">
                            {failedCount} 失败
                        </Tag>
                    ) : null}
                    <Tag className="m-0">{project.ratio}</Tag>
                </div>
            </div>
            <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="text-xs leading-5 text-muted-foreground">
                    {project.episodeCount} 集 · {project.characterCount} 角色 · {project.sceneCount} 场景 · {project.shotCount} 分镜
                </div>
                <div className="flex justify-end gap-2">
                    <Popconfirm title="删除这个短剧项目？" onConfirm={() => deleteProject(project.id).catch((error) => message.error(error instanceof Error ? error.message : "项目删除失败"))}>
                        <Button type="text" shape="circle" danger className="!size-8" icon={<Trash2 className="size-4" />} aria-label="删除项目" />
                    </Popconfirm>
                    <Button type="primary" className="!h-8 !px-3" onClick={() => router.push(`/drama/${project.id}`)}>
                        继续制作
                    </Button>
                </div>
            </div>
        </article>
    );
}
