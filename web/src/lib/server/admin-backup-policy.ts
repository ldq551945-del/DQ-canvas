type JsonRecord = Record<string, unknown>;

export function sanitizeAuthBackup(value: unknown) {
    if (!isRecord(value)) return value;
    const settings = isRecord(value.settings) ? sanitizeSettings(value.settings) : value.settings;
    return {
        ...value,
        users: asRecords(value.users).map(({ passwordHash: _passwordHash, email: _email, ...user }) => user),
        sessions: [],
        emailCodes: [],
        cdkCodes: [],
        ...(settings === undefined ? {} : { settings }),
    };
}

export function mergeAuthBackupSecrets(imported: unknown, current: unknown) {
    if (!isRecord(imported) || !isRecord(current)) throw new Error("当前服务器认证数据不可用，不能安全导入用户备份");
    const currentUsers = asRecords(current.users);
    const users = asRecords(imported.users).map((user) => {
        const existing = currentUsers.find((item) => text(item.id) === text(user.id) || text(item.username).toLowerCase() === text(user.username).toLowerCase());
        if (!existing?.passwordHash) throw new Error(`用户 ${text(user.username) || text(user.id) || "未知用户"} 在当前服务器不存在，不能从脱敏备份恢复`);
        return {
            ...user,
            email: existing.email,
            passwordHash: existing.passwordHash,
        };
    });
    return {
        ...imported,
        users,
        sessions: Array.isArray(current.sessions) ? current.sessions : [],
        emailCodes: Array.isArray(current.emailCodes) ? current.emailCodes : [],
        cdkCodes: Array.isArray(current.cdkCodes) ? current.cdkCodes : [],
        settings: mergeSettingsSecrets(imported.settings, current.settings),
    };
}

function sanitizeSettings(value: JsonRecord) {
    const mail = isRecord(value.mail) ? { ...value.mail, password: "" } : value.mail;
    const systemChannels = asRecords(value.systemChannels).map((channel) => ({ ...channel, apiKey: "" }));
    return { ...value, mail, systemChannels };
}

function mergeSettingsSecrets(imported: unknown, current: unknown) {
    if (!isRecord(imported)) return current;
    if (!isRecord(current)) return imported;
    const currentChannels = asRecords(current.systemChannels);
    const systemChannels = asRecords(imported.systemChannels).map((channel) => {
        const existing = currentChannels.find((item) => text(item.id) === text(channel.id));
        return { ...channel, apiKey: existing?.apiKey || "" };
    });
    return {
        ...imported,
        mail: {
            ...(isRecord(imported.mail) ? imported.mail : {}),
            password: isRecord(current.mail) ? current.mail.password || "" : "",
        },
        systemChannels,
    };
}

function asRecords(value: unknown) {
    return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is JsonRecord {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}
