export type ReferenceImage = {
    id: string;
    name: string;
    type: string;
    dataUrl: string;
    previewUrl?: string;
    uploadStatus?: "uploading" | "failed";
    uploadError?: string;
    url?: string;
    remoteUrl?: string;
    serverUrl?: string;
    storageKey?: string;
    width?: number;
    height?: number;
};
