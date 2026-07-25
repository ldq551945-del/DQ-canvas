export function userAvatarFallback(value: string) {
    const parts = value.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "U";
    if (parts.length > 1) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    return Array.from(parts[0]).slice(0, 2).join("").toUpperCase();
}
