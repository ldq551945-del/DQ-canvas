export function createConversationHref(conversationId: string) {
    return `/create?${new URLSearchParams({ conversationId }).toString()}`;
}

export function createConversationIdFromSearch(search: string) {
    return new URLSearchParams(search).get("conversationId")?.trim().slice(0, 160) || "";
}
