import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn() }));

vi.mock("@aws-sdk/client-s3", () => {
    class MockCommand {
        constructor(input: Record<string, unknown>) {
            Object.assign(this, input);
        }
    }
    return {
        S3Client: class {
            send = mocks.send;
            destroy = mocks.destroy;
        },
        DeleteObjectsCommand: MockCommand,
        GetObjectCommand: MockCommand,
        HeadObjectCommand: MockCommand,
        ListObjectsV2Command: MockCommand,
        PutObjectCommand: MockCommand,
    };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: vi.fn() }));
vi.mock("@/lib/server/object-storage-config", () => ({ assertObjectStorageConfigured: vi.fn() }));

import { getObjectBytes } from "./object-storage-client";

const config = {
    id: "default" as const,
    enabled: true,
    endpoint: "https://objects.example.com",
    region: "auto",
    bucket: "media",
    prefix: "dq",
    accessKeyId: "access",
    secretAccessKey: "secret",
    forcePathStyle: false,
};

describe("object storage byte limits", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("stops a streamed object as soon as it exceeds the configured limit", async () => {
        const body = {
            transformToByteArray: vi.fn(),
            destroy: vi.fn(),
            async *[Symbol.asyncIterator]() {
                yield Buffer.from("1234");
                yield Buffer.from("5678");
            },
        };
        mocks.send.mockResolvedValue({ Body: body });

        await expect(getObjectBytes(config, "large.bin", 5)).rejects.toThrow("object exceeds byte limit");
        expect(body.transformToByteArray).not.toHaveBeenCalled();
        expect(body.destroy).toHaveBeenCalledOnce();
    });

    it("returns streamed objects within the configured limit", async () => {
        const body = {
            transformToByteArray: vi.fn(),
            async *[Symbol.asyncIterator]() {
                yield Buffer.from("12");
                yield Buffer.from("34");
            },
        };
        mocks.send.mockResolvedValue({ Body: body });

        await expect(getObjectBytes(config, "small.bin", 5)).resolves.toEqual(Buffer.from("1234"));
        expect(body.transformToByteArray).not.toHaveBeenCalled();
    });
});
