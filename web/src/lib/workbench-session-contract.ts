import type { CreativeMessage } from "@/lib/creative-runtime-contract";

export type WorkbenchWorkspace = "image" | "video";

export const WORKBENCH_PUBLIC_MESSAGE_VISIBILITY = "public";

export type CreativeWorkbenchSessionSummary = {
    id: string;
    recordId?: string;
    title: string;
    lastPrompt: string;
    searchText: string;
    updatedAt: number;
};

export type CreativeWorkbenchSessionDetail = {
    id: string;
    recordId?: string;
    messages: CreativeMessage[];
    hasMore: boolean;
    nextBeforeSequence?: number;
};
