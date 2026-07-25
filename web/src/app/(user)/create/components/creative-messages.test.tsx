import { App } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { CreativeAsset, CreativeMessage } from "@/lib/creative-runtime-contract";

import { CreativeMessages } from "./creative-messages";

describe("CreativeMessages", () => {
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
                    onEditMessage={vi.fn()}
                    selectedAssetIds={[]}
                    onToggleAsset={vi.fn()}
                />
            </App>,
        );

        expect(markup).toContain("max-w-[280px]");
        expect(markup).toContain("object-contain");
        expect(markup).toContain("max-h-[min(42dvh,360px)]");
        expect(markup).toContain("h-36 sm:h-40");
        expect(markup).toContain("引用素材");
        expect(markup).not.toContain("aspect-square");
    });
});
