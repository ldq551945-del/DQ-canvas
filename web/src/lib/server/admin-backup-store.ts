import { normalizeDb as normalizeAuthDb } from "@/lib/auth/store-normalizers";
import type { AuthDatabase } from "@/lib/auth/store-types";
import { readAuthDb, readPostgresAuthDb, writeAuthDb, writePostgresAuthDbWithExecutor } from "@/lib/auth/store-repository";
import { readPromptBackup, readPostgresPromptDb, type PromptDatabase, writePostgresPromptDbWithExecutor, writePromptBackup } from "@/lib/prompts/store";
import { ensurePostgresSchema, getDatabaseProvider, withPostgresTransaction, type QueryExecutor } from "@/lib/server/database";
import { readGenerationLogDb, readPostgresGenerationLogDb, writeGenerationLogDb, writePostgresGenerationLogDbWithExecutor } from "@/lib/server/generation-log-repository";
import type { GenerationLogDatabase } from "@/lib/server/generation-log-types";
import { readAccountDeletionRequestBackup, writeAccountDeletionRequestBackup, type AccountDeletionRequestDatabase } from "@/lib/server/database/account-deletion-request-repository";

export type AdminBackupData = {
    auth: AuthDatabase;
    prompts: PromptDatabase;
    generationLogs: GenerationLogDatabase;
    accountDeletionRequests: AccountDeletionRequestDatabase;
};

export async function readAdminBackupData(): Promise<AdminBackupData> {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        return withPostgresTransaction(async (client) => ({
            auth: await readPostgresAuthDb(client),
            prompts: await readPostgresPromptDb(client),
            generationLogs: await readPostgresGenerationLogDb(client),
            accountDeletionRequests: await readAccountDeletionRequestBackup(client),
        }));
    }
    const [auth, prompts, generationLogs, accountDeletionRequests] = await Promise.all([readAuthDb(), readPromptBackup(), readGenerationLogDb(), readAccountDeletionRequestBackup()]);
    return { auth, prompts, generationLogs, accountDeletionRequests };
}

export async function restoreAdminBackupData(data: AdminBackupData) {
    const auth = normalizeAuthDb(data.auth);
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        await withPostgresTransaction(async (client) => restorePostgresBackup(client, auth, data.prompts, data.generationLogs, data.accountDeletionRequests));
        return;
    }
    await Promise.all([writeAuthDb(auth), writePromptBackup(data.prompts), writeGenerationLogDb(data.generationLogs), writeAccountDeletionRequestBackup(data.accountDeletionRequests)]);
}

async function restorePostgresBackup(client: QueryExecutor, auth: AuthDatabase, prompts: PromptDatabase, generationLogs: GenerationLogDatabase, accountDeletionRequests: AccountDeletionRequestDatabase) {
    await writePostgresAuthDbWithExecutor(auth, client);
    await writePostgresPromptDbWithExecutor(prompts, client);
    await writePostgresGenerationLogDbWithExecutor(generationLogs, client);
    await writeAccountDeletionRequestBackup(accountDeletionRequests, client);
}
