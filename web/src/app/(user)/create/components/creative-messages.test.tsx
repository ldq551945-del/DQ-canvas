import { App } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { CreativeAsset, CreativeMessage } from "@/lib/creative-runtime-contract";

import { CreativeMessages } from "./creative-messages";

describe("CreativeMessages", () => {
    it("renders completed assistant markdown instead of showing syntax markers", () => {
        const message: CreativeMessage = {
            id: "assistant-markdown",
            conversationId: "conversation-one",
            sequence: 2,
            role: "assistant",
            status: "completed",
            content: "以下为一份**通用专业简历报告模板**。\n\n---\n\n# 个人职业简历报告",
            metadata: {},
            createdAt: 1,
            updatedAt: 1,
        };
        const markup = renderMessages(message);

        expect(markup).toContain("<strong");
        expect(markup).toContain("通用专业简历报告模板</strong>");
        expect(markup).toContain("<hr");
        expect(markup).toContain("<h1");
        expect(markup).not.toContain("**通用专业简历报告模板**");
    });

    it("renders current-turn reference images above the user message", () => {
        const message: CreativeMessage = {
            id: "user-message",
            conversationId: "conversation-one",
            sequence: 1,
            role: "user",
            status: "completed",
            content: "把她换成白发",
            metadata: { assetIds: ["reference-one"] },
            createdAt: 1,
            updatedAt: 1,
        };
        const asset: CreativeAsset = {
            id: "reference-one",
            userId: "user-one",
            conversationId: "conversation-one",
            sourceRunId: "upload",
            ordinal: 0,
            type: "image",
            status: "ready",
            title: "人物参考图",
            serverUrl: "/api/reference-assets/permanent/person.png",
            storageKey: "permanent/person.png",
            mimeType: "image/png",
            metadata: {},
            createdAt: 1,
            updatedAt: 1,
        };
        const markup = renderToStaticMarkup(
            <App>
                <CreativeMessages
                    messages={[message]}
                    assets={[asset]}
                    loading={false}
                    projectLinks={{}}
                    projectErrors={{}}
                    runDetails={{}}
                    onMaterializeProject={async () => {
                        throw new Error("not used");
                    }}
                    onRetryTask={vi.fn()}
                    onRetryRun={vi.fn()}
                    onRetrySubmission={vi.fn()}
                    onEditMessage={vi.fn()}
                    selectedAssetIds={[]}
                    onToggleAsset={vi.fn()}
                />
            </App>,
        );

        expect(markup).toContain('aria-label="本轮参考素材"');
        expect(markup.indexOf('alt="人物参考图"')).toBeLessThan(markup.indexOf("把她换成白发"));
    });

    it("keeps generated media compact without cropping it", () => {
        const message: CreativeMessage = {
            id: "message-one",
            conversationId: "conversation-one",
            sequence: 1,
            role: "assistant",
            status: "completed",
            content: "图片已生成。",
            metadata: {},
            createdAt: 1,
            updatedAt: 1,
        };
        const asset: CreativeAsset = {
            id: "asset-one",
            userId: "user-one",
            conversationId: "conversation-one",
            messageId: message.id,
            ordinal: 0,
            type: "image",
            status: "ready",
            title: "生成图片",
            serverUrl: "/generated/image.png",
            metadata: {},
            createdAt: 1,
            updatedAt: 1,
        };
        const markup = renderToStaticMarkup(
            <App>
                <CreativeMessages
                    messages={[message]}
                    assets={[asset]}
                    loading={false}
                    projectLinks={{}}
                    projectErrors={{}}
                    runDetails={{}}
                    onMaterializeProject={async () => {
                        throw new Error("not used");
                    }}
                    onRetryTask={vi.fn()}
                    onRetryRun={vi.fn()}
                    onRetrySubmission={vi.fn()}
                    onEditMessage={vi.fn()}
                    selectedAssetIds={[]}
                    onToggleAsset={vi.fn()}
                />
            </App>,
        );

        expect(markup).toContain("max-w-[1040px]");
        expect(markup).toContain("flex-wrap");
        expect(markup).toContain("w-[min(100%,240px)]");
        expect(markup).toContain("object-contain");
        expect(markup).toContain("!size-full object-contain");
        expect(markup).toContain("h-36 sm:h-40");
        expect(markup).toContain('aria-label="引用素材"');
        expect(markup).toContain('aria-label="下载图片"');
        expect(markup).toContain('aria-label="复制消息"');
        expect(markup).toContain("mt-1 flex min-h-8 items-center justify-end");
        expect(markup).not.toContain("absolute bottom-2 right-2");
        expect(markup).not.toContain("drop-shadow(0_1px_2px_rgba(0,0,0,0.85))");
        expect(markup).not.toContain("bg-white/90");
        expect(markup).not.toContain("<figcaption");
        expect(markup).not.toContain(">引用素材<");
        expect(markup).not.toContain("border-stone-200 bg-stone-50");
        expect(markup).not.toContain("aspect-square");
    });

    it("offers an in-place retry for an initial submission failure", () => {
        const message: CreativeMessage = {
            id: "temporary-assistant",
            conversationId: "pending",
            sequence: 2,
            role: "assistant",
            status: "failed",
            content: "创作请求失败",
            metadata: {},
            createdAt: 1,
            updatedAt: 1,
        };
        const markup = renderToStaticMarkup(
            <App>
                <CreativeMessages
                    messages={[message]}
                    assets={[]}
                    loading={false}
                    projectLinks={{}}
                    projectErrors={{}}
                    runDetails={{}}
                    onMaterializeProject={async () => {
                        throw new Error("not used");
                    }}
                    onRetryTask={vi.fn()}
                    onRetryRun={vi.fn()}
                    onRetrySubmission={vi.fn()}
                    onEditMessage={vi.fn()}
                    selectedAssetIds={[]}
                    onToggleAsset={vi.fn()}
                />
            </App>,
        );

        expect(markup).toContain('aria-label="重试本次创作请求"');
        expect(markup).toContain("重试");
    });

    it("offers an explicit retry when Agent planning finished with an uncertain result", () => {
        const message: CreativeMessage = {
            id: "assistant-message",
            conversationId: "conversation-one",
            runId: "run-one",
            sequence: 2,
            role: "assistant",
            status: "failed",
            content: "Agent 规划请求结果待确认",
            metadata: {},
            createdAt: 1,
            updatedAt: 1,
        };
        const markup = renderToStaticMarkup(
            <App>
                <CreativeMessages
                    messages={[message]}
                    assets={[]}
                    loading={false}
                    projectLinks={{}}
                    projectErrors={{}}
                    runDetails={{
                        "run-one": {
                            id: "run-one",
                            conversationId: "conversation-one",
                            inputMessageId: "user-message",
                            assistantMessageId: message.id,
                            status: "failed",
                            assetIds: [],
                            tasks: [],
                        },
                    }}
                    onMaterializeProject={async () => {
                        throw new Error("not used");
                    }}
                    onRetryTask={vi.fn()}
                    onRetryRun={vi.fn()}
                    onRetrySubmission={vi.fn()}
                    onEditMessage={vi.fn()}
                    selectedAssetIds={[]}
                    onToggleAsset={vi.fn()}
                />
            </App>,
        );

        expect(markup).toContain('aria-label="重新分析本次请求"');
        expect(markup).toContain("仅在你确认后重新请求");
    });
});

function renderMessages(message: CreativeMessage) {
    return renderToStaticMarkup(
        <App>
            <CreativeMessages
                messages={[message]}
                assets={[]}
                loading={false}
                projectLinks={{}}
                projectErrors={{}}
                runDetails={{}}
                onMaterializeProject={async () => {
                    throw new Error("not used");
                }}
                onRetryTask={vi.fn()}
                onRetryRun={vi.fn()}
                onRetrySubmission={vi.fn()}
                onEditMessage={vi.fn()}
                selectedAssetIds={[]}
                onToggleAsset={vi.fn()}
            />
        </App>,
    );
}
