import { nanoid } from "nanoid";

import type { CreateDramaProjectInput, DramaAssetProfile, DramaAssetReference, DramaEpisode, DramaNamedAsset, DramaProject, DramaShot, DramaShotContinuity, DramaUtterance, DramaVideoMode } from "@/lib/drama-project-contract";
import { createCreativeConversation, updateCreativeConversation } from "@/lib/server/creative-runtime-store";
import { createDramaProject, deleteDramaProject, DramaProjectStoreError, findDramaProjectBySourceHandoffId, getDramaProject, listDramaProjectSummaries, updateDramaProject } from "@/lib/server/drama-project-store";
import { createDramaProjectVersion, getDramaProjectVersion, listDramaProjectVersions } from "@/lib/server/drama-project-version-store";
import { collectLocalMediaStorageKeys } from "@/lib/server/local-media-references";
import { deleteUserLocalMediaAssets } from "@/lib/server/local-media-storage";

const MAX_PROJECT_BYTES = 2 * 1024 * 1024;

export class DramaProjectServiceError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
    }
}

export function listDramaProjectSummariesForUser(userId: string) {
    return listDramaProjectSummaries(userId);
}

export async function getDramaProjectForUser(userId: string, id: string) {
    const project = await getDramaProject(cleanText(id, 160), userId);
    if (!project) throw new DramaProjectServiceError("短剧项目不存在", 404);
    return project;
}

export async function createDramaProjectForUser(userId: string, value: unknown) {
    const input = normalizeCreateInput(value);
    const now = new Date().toISOString();
    if (input.sourceHandoffId) {
        const existing = await findDramaProjectBySourceHandoffId(userId, input.sourceHandoffId);
        if (existing) return existing;
    }
    const projectId = input.sourceHandoffId ? `drama-${input.sourceHandoffId}` : `drama-${nanoid()}`;
    const episode: DramaEpisode = {
        id: `episode-${nanoid()}`,
        title: "第 1 集",
        script: input.initialScript,
        outline: "",
        hook: "",
        nextPreview: "",
        sourceRange: "",
        reviewStatus: "draft",
        shots: [],
    };
    const conversation = await createCreativeConversation(userId, { surface: "drama", projectId, title: input.title });
    const project: DramaProject = {
        id: projectId,
        sourceHandoffId: input.sourceHandoffId,
        title: input.title,
        summary: input.summary,
        style: input.style,
        ratio: input.ratio,
        status: "active",
        creativeConversationId: conversation.id,
        activeEpisodeId: episode.id,
        characters: [],
        scenes: [],
        props: [],
        clues: [],
        defaultVideoMode: input.defaultVideoMode,
        episodes: [episode],
        sourceAssets: input.sourceAssets,
        createdAt: now,
        updatedAt: now,
    };
    try {
        return await createDramaProject(userId, project);
    } catch (error) {
        await updateCreativeConversation(conversation.id, userId, { status: "archived" }).catch(() => null);
        throw error;
    }
}

export async function updateDramaProjectForUser(userId: string, id: string, value: unknown) {
    const current = await getDramaProjectForUser(userId, id);
    const size = Buffer.byteLength(JSON.stringify(value || {}));
    if (size > MAX_PROJECT_BYTES) throw new DramaProjectServiceError("短剧项目数据过大", 413);
    const incomingUpdatedAt = parseTimestamp(object(value).updatedAt);
    if (incomingUpdatedAt && incomingUpdatedAt < parseTimestamp(current.updatedAt)) return current;
    const project = normalizeProject(value, current);
    if (incomingUpdatedAt) project.updatedAt = new Date(incomingUpdatedAt).toISOString();
    try {
        return await updateDramaProject(userId, project, current.updatedAt);
    } catch (error) {
        if (error instanceof DramaProjectStoreError) throw new DramaProjectServiceError(error.message, error.status);
        throw error;
    }
}

export async function listDramaProjectVersionsForUser(userId: string, id: string) {
    await getDramaProjectForUser(userId, cleanText(id, 160));
    return listDramaProjectVersions(userId, cleanText(id, 160));
}

export async function createDramaProjectVersionForUser(userId: string, id: string, value: unknown) {
    const current = await getDramaProjectForUser(userId, cleanText(id, 160));
    const input = object(value);
    const snapshot = normalizeProject(input.snapshot, current);
    if (Buffer.byteLength(JSON.stringify(snapshot)) > MAX_PROJECT_BYTES) throw new DramaProjectServiceError("短剧版本数据过大", 413);
    const reason = cleanText(input.reason, 200) || "手动保存版本";
    return createDramaProjectVersion(userId, current.id, reason, snapshot);
}

export async function restoreDramaProjectVersionForUser(userId: string, id: string, versionId: string) {
    const projectId = cleanText(id, 160);
    const current = await getDramaProjectForUser(userId, projectId);
    const version = await getDramaProjectVersion(userId, projectId, cleanText(versionId, 160));
    if (!version) throw new DramaProjectServiceError("短剧版本不存在", 404);
    await createDramaProjectVersion(userId, projectId, "恢复前自动快照", current);
    try {
        return await updateDramaProject(userId, normalizeProject(version.snapshot, current), current.updatedAt);
    } catch (error) {
        if (error instanceof DramaProjectStoreError) throw new DramaProjectServiceError(error.message, error.status);
        throw error;
    }
}

export async function deleteDramaProjectForUser(userId: string, id: string) {
    const projectId = cleanText(id, 160);
    const current = await getDramaProject(projectId, userId);
    const deleted = await deleteDramaProject(userId, projectId);
    if (!deleted) throw new DramaProjectServiceError("短剧项目不存在", 404);
    if (current?.creativeConversationId) await updateCreativeConversation(current.creativeConversationId, userId, { status: "archived" });
    if (current) await deleteUserLocalMediaAssets(userId, collectLocalMediaStorageKeys(current));
}

function normalizeCreateInput(value: unknown): Required<Omit<CreateDramaProjectInput, "sourceAssets" | "sourceHandoffId">> & Pick<CreateDramaProjectInput, "sourceAssets" | "sourceHandoffId"> {
    const input = object(value);
    const title = cleanText(input.title, 120);
    if (!title) throw new DramaProjectServiceError("项目名称不能为空", 400);
    return {
        title,
        sourceHandoffId: optionalText(input.sourceHandoffId, 160),
        summary: cleanText(input.summary, 2000),
        style: cleanText(input.style, 500) || "电影感国漫",
        ratio: input.ratio === "16:9" ? "16:9" : "9:16",
        initialScript: cleanText(input.initialScript, 100_000),
        sourceAssets: normalizeSourceAssets(input.sourceAssets),
        defaultVideoMode: videoMode(input.defaultVideoMode),
    };
}

export function normalizeProject(value: unknown, current: DramaProject): DramaProject {
    const input = object(value);
    const episodes = array(input.episodes)
        .slice(0, 100)
        .map(normalizeEpisode)
        .filter((episode): episode is DramaEpisode => Boolean(episode));
    if (!episodes.length) throw new DramaProjectServiceError("短剧项目至少需要一集", 400);
    const activeEpisodeId = cleanText(input.activeEpisodeId, 160);
    return {
        id: current.id,
        sourceHandoffId: current.sourceHandoffId,
        title: cleanText(input.title, 120) || current.title,
        summary: cleanText(input.summary, 2000),
        style: cleanText(input.style, 500),
        ratio: input.ratio === "16:9" ? "16:9" : "9:16",
        status: input.status === "archived" ? "archived" : "active",
        creativeConversationId: current.creativeConversationId,
        activeEpisodeId: episodes.some((episode) => episode.id === activeEpisodeId) ? activeEpisodeId : episodes[0].id,
        characters: normalizeNamedAssets(input.characters, "character", 200, true),
        scenes: normalizeNamedAssets(input.scenes, "scene", 200),
        props: normalizeNamedAssets(input.props, "prop", 200),
        clues: normalizeClues(input.clues),
        defaultVideoMode: videoMode(input.defaultVideoMode),
        episodes,
        sourceAssets: normalizeSourceAssets(input.sourceAssets),
        createdAt: current.createdAt,
        updatedAt: nextTimestamp(current.updatedAt),
    };
}

function normalizeEpisode(value: unknown): DramaEpisode | null {
    const input = object(value);
    const id = cleanText(input.id, 160);
    if (!id) return null;
    const render = object(input.renderTask);
    const renderStatus = render.status;
    const renderTask =
        cleanText(render.id, 160) && ["pending", "running", "success", "error", "cancelled"].includes(String(renderStatus))
            ? {
                  id: cleanText(render.id, 160),
                  status: renderStatus as "pending" | "running" | "success" | "error" | "cancelled",
                  result: stableUrl(object(render.result).url) ? { url: stableUrl(object(render.result).url) } : undefined,
                  error: optionalText(render.error, 1000),
              }
            : undefined;
    return {
        id,
        title: cleanText(input.title, 120) || "未命名剧集",
        script: cleanText(input.script, 100_000),
        outline: cleanText(input.outline, 4000),
        hook: cleanText(input.hook, 2000),
        nextPreview: cleanText(input.nextPreview, 2000),
        sourceRange: cleanText(input.sourceRange, 500),
        reviewStatus: reviewStatus(input.reviewStatus),
        shots: array(input.shots).slice(0, 500).map(normalizeShot),
        renderTask,
        visualReview: normalizeVisualReview(input.visualReview),
    };
}

function normalizeVisualReview(value: unknown): DramaEpisode["visualReview"] {
    const input = object(value);
    const mode = input.mode === "visual" || input.mode === "text" || input.mode === "unavailable" ? input.mode : null;
    const status = input.status === "passed" || input.status === "needs_revision" || input.status === "unavailable" ? input.status : null;
    const summary = cleanText(input.summary, 1200);
    if (!mode || !status || !summary) return undefined;
    const scoreValue = Number(input.score);
    const issues = array(input.issues)
        .slice(0, 8)
        .flatMap((item) => {
            const issue = object(item);
            const category = cleanText(issue.category, 80);
            const message = cleanText(issue.message, 500);
            if (!category || !message) return [];
            const severity: "low" | "medium" | "high" = issue.severity === "high" || issue.severity === "medium" ? issue.severity : "low";
            return [
                {
                    taskId: optionalText(issue.taskId, 160),
                    category,
                    severity,
                    message,
                    correction: optionalText(issue.correction, 500),
                },
            ];
        });
    return {
        mode,
        status,
        score: Number.isFinite(scoreValue) ? Math.max(0, Math.min(100, Math.round(scoreValue))) : undefined,
        summary,
        issues,
        retryTaskIds: ids(input.retryTaskIds),
    };
}

function normalizeShot(value: unknown, index: number): DramaShot {
    const input = object(value);
    return {
        id: cleanText(input.id, 160) || `shot-${nanoid()}`,
        order: Math.max(1, Math.floor(Number(input.order) || index + 1)),
        title: cleanText(input.title, 160) || `镜头 ${index + 1}`,
        description: cleanText(input.description, 4000),
        sourceText: cleanText(input.sourceText, 8000),
        shotBoundary: cleanText(input.shotBoundary, 500),
        dialogue: cleanText(input.dialogue, 4000),
        narration: cleanText(input.narration, 4000),
        utterances: normalizeUtterances(input.utterances),
        imagePrompt: cleanText(input.imagePrompt, 8000),
        videoPrompt: cleanText(input.videoPrompt, 8000),
        cameraMotion: cleanText(input.cameraMotion, 2000),
        startFramePrompt: optionalText(input.startFramePrompt, 8000),
        endFramePrompt: optionalText(input.endFramePrompt, 8000),
        negativePrompt: optionalText(input.negativePrompt, 2000),
        continuity: normalizeContinuity(input.continuity),
        duration: Math.max(1, Math.min(20, Number(input.duration) || 5)),
        characterIds: array(input.characterIds)
            .map((id) => cleanText(id, 160))
            .filter(Boolean)
            .slice(0, 50),
        propIds: ids(input.propIds),
        clueIds: ids(input.clueIds),
        sceneId: optionalText(input.sceneId, 160),
        videoMode: videoMode(input.videoMode),
        storyboardFrameMode: input.storyboardFrameMode === "first_last" ? "first_last" : "single",
        storyboardStatus: taskStatus(input.storyboardStatus),
        storyboardAttempt: optionalPositiveInteger(input.storyboardAttempt),
        storyboardTaskId: optionalText(input.storyboardTaskId, 160),
        storyboardError: optionalText(input.storyboardError, 1000),
        storyboardImageUrl: stableUrl(input.storyboardImageUrl),
        storyboardEndStatus: taskStatus(input.storyboardEndStatus),
        storyboardEndAttempt: optionalPositiveInteger(input.storyboardEndAttempt),
        storyboardEndTaskId: optionalText(input.storyboardEndTaskId, 160),
        storyboardEndError: optionalText(input.storyboardEndError, 1000),
        storyboardEndImageUrl: stableUrl(input.storyboardEndImageUrl),
        generationStatus: taskStatus(input.generationStatus),
        generationAttempt: optionalPositiveInteger(input.generationAttempt),
        generationTaskId: optionalText(input.generationTaskId, 160),
        generationError: optionalText(input.generationError, 1000),
        videoUrl: stableUrl(input.videoUrl),
        subtitle: optionalText(input.subtitle, 4000),
        audioMode: input.audioMode === "voiceover" || input.audioMode === "mute" ? input.audioMode : "source",
        audioStatus: taskStatus(input.audioStatus),
        audioAttempt: optionalPositiveInteger(input.audioAttempt),
        audioTaskId: optionalText(input.audioTaskId, 160),
        audioError: optionalText(input.audioError, 1000),
        audioUrl: stableUrl(input.audioUrl),
    };
}

function normalizeNamedAssets(value: unknown, prefix: string, limit: number, character = false): DramaNamedAsset[] {
    return array(value)
        .slice(0, limit)
        .map((item) => {
            const input = object(item);
            const id = cleanText(input.id, 160) || `${prefix}-${nanoid()}`;
            const references = normalizeAssetReferences(input.references, id, input.referenceImageUrl, input.referenceStorageKey);
            const primaryReferenceId = references.some((reference) => reference.id === input.primaryReferenceId) ? String(input.primaryReferenceId) : references[0]?.id;
            const primaryReference = references.find((reference) => reference.id === primaryReferenceId);
            return {
                id,
                name: cleanText(input.name, 120),
                description: cleanText(input.description, 2000),
                profile: normalizeAssetProfile(input.profile),
                references,
                primaryReferenceId,
                referenceImageUrl: primaryReference?.url,
                referenceStorageKey: primaryReference?.storageKey,
                ...(character ? { voiceProfile: normalizeVoiceProfile(input.voiceProfile) } : {}),
            };
        })
        .filter((item) => item.name);
}

function normalizeClues(value: unknown) {
    return array(value)
        .slice(0, 200)
        .flatMap((item) => {
            const input = object(item);
            const name = cleanText(input.name, 120);
            if (!name) return [];
            const id = cleanText(input.id, 160) || `clue-${nanoid()}`;
            const references = normalizeAssetReferences(input.references, id, input.referenceImageUrl, input.referenceStorageKey);
            const primaryReferenceId = references.some((reference) => reference.id === input.primaryReferenceId) ? String(input.primaryReferenceId) : references[0]?.id;
            const primaryReference = references.find((reference) => reference.id === primaryReferenceId);
            return [
                {
                    id,
                    name,
                    description: cleanText(input.description, 2000),
                    profile: normalizeAssetProfile(input.profile),
                    references,
                    primaryReferenceId,
                    payoff: cleanText(input.payoff, 2000),
                    referenceImageUrl: primaryReference?.url,
                    referenceStorageKey: primaryReference?.storageKey,
                },
            ];
        });
}

function normalizeAssetProfile(value: unknown): DramaAssetProfile {
    const input = object(value);
    return {
        visualIdentity: cleanText(input.visualIdentity, 2000),
        styling: cleanText(input.styling, 2000),
        colorPalette: cleanText(input.colorPalette, 500),
        consistencyRules: cleanText(input.consistencyRules, 2000),
    };
}

function normalizeAssetReferences(value: unknown, assetId: string, legacyUrl: unknown, legacyStorageKey: unknown): DramaAssetReference[] {
    const references = array(value)
        .slice(0, 12)
        .flatMap((item, index) => {
            const input = object(item);
            const url = stableUrl(input.url);
            if (!url) return [];
            const source: DramaAssetReference["source"] = input.source === "generated" || input.source === "library" ? input.source : "upload";
            return [
                {
                    id: cleanText(input.id, 160) || `${assetId}-reference-${index + 1}`,
                    url,
                    storageKey: optionalText(input.storageKey, 500),
                    source,
                    label: cleanText(input.label, 160) || `参考图 ${index + 1}`,
                    createdAt: timestamp(input.createdAt) || new Date(0).toISOString(),
                },
            ];
        });
    const url = stableUrl(legacyUrl);
    if (!references.length && url) references.push({ id: `${assetId}-reference-legacy`, url, storageKey: optionalText(legacyStorageKey, 500), source: "library", label: "原参考图", createdAt: new Date(0).toISOString() });
    return references;
}

function normalizeVoiceProfile(value: unknown) {
    const input = object(value);
    return {
        voice: cleanText(input.voice, 160),
        speed: Math.max(0.25, Math.min(4, Number(input.speed) || 1)),
        instructions: cleanText(input.instructions, 1000),
    };
}

function normalizeContinuity(value: unknown): DramaShotContinuity {
    const input = object(value);
    return {
        shotSize: cleanText(input.shotSize, 120),
        cameraAngle: cleanText(input.cameraAngle, 200),
        composition: cleanText(input.composition, 500),
        characterBlocking: cleanText(input.characterBlocking, 1200),
        gazeDirection: cleanText(input.gazeDirection, 500),
        actionStart: cleanText(input.actionStart, 1200),
        actionEnd: cleanText(input.actionEnd, 1200),
        screenDirection: cleanText(input.screenDirection, 500),
        axisRule: cleanText(input.axisRule, 500),
        continuityNotes: cleanText(input.continuityNotes, 1200),
    };
}

function normalizeUtterances(value: unknown): DramaUtterance[] {
    return array(value)
        .slice(0, 100)
        .map((item, index) => {
            const input = object(item);
            return {
                id: cleanText(input.id, 160) || `utterance-${nanoid()}`,
                order: Math.max(1, Math.floor(Number(input.order) || index + 1)),
                type: input.type === "voiceover" ? "voiceover" : "dialogue",
                speaker: cleanText(input.speaker, 120),
                text: cleanText(input.text, 4000),
            } as DramaUtterance;
        })
        .filter((item) => item.text);
}

function ids(value: unknown) {
    return array(value)
        .map((id) => cleanText(id, 160))
        .filter(Boolean)
        .slice(0, 50);
}

function reviewStatus(value: unknown): DramaEpisode["reviewStatus"] {
    return value === "content_review" || value === "approved" || value === "visual_ready" ? value : "draft";
}

function videoMode(value: unknown): DramaVideoMode {
    return value === "direct" || value === "reference" ? value : "storyboard";
}

function normalizeSourceAssets(value: unknown) {
    return array(value)
        .slice(0, 100)
        .map((item) => {
            const asset = object(item);
            const type = ["text", "image", "video", "audio"].includes(String(asset.type)) ? (asset.type as "text" | "image" | "video" | "audio") : "text";
            return {
                id: cleanText(asset.id, 160) || `source-${nanoid()}`,
                type,
                title: cleanText(asset.title, 160) || "创作素材",
                textContent: type === "text" ? optionalText(asset.textContent, 100_000) : undefined,
                storageKey: optionalText(asset.storageKey, 500),
                remoteUrl: stableUrl(asset.remoteUrl),
                serverUrl: stableUrl(asset.serverUrl),
                mimeType: optionalText(asset.mimeType, 120),
            };
        });
}

function taskStatus(value: unknown) {
    return ["idle", "queued", "running", "success", "error", "cancelled"].includes(String(value)) ? (value as DramaShot["generationStatus"]) : undefined;
}

function optionalPositiveInteger(value: unknown) {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) && number > 0 ? number : undefined;
}

function stableUrl(value: unknown) {
    const text = cleanText(value, 4000);
    return text && !text.startsWith("data:") && !text.startsWith("blob:") ? text : undefined;
}

function optionalText(value: unknown, max: number) {
    return cleanText(value, max) || undefined;
}

function cleanText(value: unknown, max: number) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseTimestamp(value: unknown) {
    const time = Date.parse(String(value || ""));
    return Number.isFinite(time) ? time : 0;
}

function nextTimestamp(previous: string) {
    return new Date(Math.max(Date.now(), parseTimestamp(previous) + 1)).toISOString();
}

function timestamp(value: unknown) {
    const time = parseTimestamp(value);
    return time ? new Date(time).toISOString() : "";
}

function object(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function array(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}
