import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { applicationDataDirectory } from "@/lib/app-data";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { Prisma } from "@prisma/client";
import type { AIImageReference } from "@/services/ai/types";
import { ensureCharacterIdentityStorage } from "./identity-pack-storage";

export const CHARACTER_IDENTITY_STYLE_TYPES = ["2D", "3D", "anime", "clay", "other"] as const;
export const CHARACTER_REFERENCE_ROLES = ["front", "left_profile", "right_profile", "three_quarter", "full_body", "back", "expression"] as const;
export type CharacterReferenceRole = typeof CHARACTER_REFERENCE_ROLES[number];
export type CharacterIdentityPackSummary = {
  characterId: string;
  channelId: string;
  name: string;
  styleType: string;
  lockedTraits: Record<string, unknown>;
  allowedVariations: string[];
  negativeRules: string[];
  active: boolean;
  referenceImages: Array<{ assetId: string; storageKey: string; referenceId: string | null; viewRole: string; active: boolean; name: string | null; mimeType: string | null; url: string }>;
};
export type CharacterIdentityPackInput = {
  name?: string;
  styleType?: string;
  lockedTraits?: Record<string, unknown>;
  allowedVariations?: string[];
  negativeRules?: string[];
};

function appDataRoot() { return applicationDataDirectory(process.env.APPDATA ?? process.env.LOCALAPPDATA ?? process.cwd()); }
function characterRoot() { return path.join(appDataRoot(), "channel-characters"); }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function asStrings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function safeImageKey(value: string) { const file = path.basename(value); if (file !== value || !/^[A-Za-z0-9_-]+\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file)) throw new AppError("CHANNEL_CHARACTER_IMAGE_INVALID", "Ảnh tham chiếu nhân vật không hợp lệ.", 409); return file; }

async function readReference(reference: { storageKey: string; mimeType: string | null; name: string | null }) {
  const key = safeImageKey(reference.storageKey); const filePath = path.join(characterRoot(), key); const metadata = await stat(filePath).catch(() => null);
  if (!metadata?.isFile() || metadata.size <= 0 || metadata.size > 20 * 1024 * 1024) throw new AppError("CHANNEL_CHARACTER_IMAGE_MISSING", "Ảnh tham chiếu nhân vật đã khai báo nhưng không còn trên máy.", 409);
  return { mimeType: reference.mimeType ?? "image/png", data: (await readFile(filePath)).toString("base64"), name: reference.name ?? key } satisfies AIImageReference;
}

export async function ensureChannelCharacterIdentityPack(channelId: string, userId?: string) {
  await ensureCharacterIdentityStorage();
  const channel = await db.channel.findFirst({ where: { id: channelId, ...(userId ? { userId } : {}) }, select: { id: true, name: true, visualStyle: true, mainCharacterImageKey: true, mainCharacterImageName: true, mainCharacterImageMimeType: true } });
  if (!channel) return null;
  let pack = await db.characterIdentityPack.findUnique({ where: { channelId: channel.id }, include: { referenceImages: { where: { active: true }, orderBy: { createdAt: "asc" } } } });
  if (!pack && channel.mainCharacterImageKey) {
    pack = await db.characterIdentityPack.create({ data: { channelId: channel.id, name: `${channel.name} — Nhân vật chính`, styleType: channel.visualStyle || "other", lockedTraits: { identitySource: "CHANNEL_REFERENCE", faceIdentity: "LOCKED", facialStructure: "LOCKED", skinTone: "LOCKED", baseHairstyle: "LOCKED", bodyProportions: "LOCKED", bodyBuild: "LOCKED", ageAppearance: "LOCKED", distinctiveTraits: "LOCKED", coreCharacterDesignLanguage: "LOCKED" }, allowedVariations: ["clothing", "shoes", "glasses", "hats", "accessories", "scene props", "emotion", "pose", "temporary condition"], negativeRules: ["Do not invent a replacement main character.", "Do not drift face, body build, skin tone or base hairstyle."], referenceImages: { create: { id: randomUUID(), assetId: randomUUID(), storageKey: channel.mainCharacterImageKey, referenceId: null, viewRole: "front", active: true, name: channel.mainCharacterImageName, mimeType: channel.mainCharacterImageMimeType } } }, include: { referenceImages: { where: { active: true }, orderBy: { createdAt: "asc" } } } });
  }
  if (pack && !pack.referenceImages.length && channel.mainCharacterImageKey) {
    await db.characterIdentityReference.create({ data: { id: randomUUID(), packId: pack.id, assetId: randomUUID(), storageKey: channel.mainCharacterImageKey, referenceId: null, viewRole: "front", active: true, name: channel.mainCharacterImageName, mimeType: channel.mainCharacterImageMimeType } });
    pack = await db.characterIdentityPack.findUnique({ where: { channelId: channel.id }, include: { referenceImages: { where: { active: true }, orderBy: { createdAt: "asc" } } } });
  }
  return pack;
}

export async function getCharacterIdentityPack(channelId: string, userId: string) {
  const pack = await ensureChannelCharacterIdentityPack(channelId, userId);
  if (!pack || !pack.active || !pack.referenceImages.length) return null;
  return { characterId: pack.id, channelId: pack.channelId, name: pack.name, styleType: pack.styleType, lockedTraits: asRecord(pack.lockedTraits), allowedVariations: asStrings(pack.allowedVariations), negativeRules: asStrings(pack.negativeRules), active: pack.active, referenceImages: pack.referenceImages.map(reference => ({ assetId: reference.assetId, storageKey: reference.storageKey, referenceId: reference.referenceId, viewRole: reference.viewRole, active: reference.active, name: reference.name, mimeType: reference.mimeType, url: `/api/v1/channels/${channelId}/character-image?assetId=${encodeURIComponent(reference.assetId)}` })) } satisfies CharacterIdentityPackSummary;
}

export async function readChannelCharacterIdentityReferences(channelId: string, userId: string) {
  const pack = await ensureChannelCharacterIdentityPack(channelId, userId);
  if (!pack || !pack.active || !pack.referenceImages.length) throw new AppError("MAIN_CHARACTER_IDENTITY_MISSING", "Channel chưa có Character Identity Pack và reference nhân vật chính.", 409);
  return Promise.all(pack.referenceImages.filter(reference => reference.active).map(async reference => ({ ...reference, image: await readReference(reference) })));
}

export function buildCharacterIdentityInstruction(pack: CharacterIdentityPackSummary) {
  return [
    `PRESERVE IDENTITY: use the approved Character Identity Pack "${pack.name}" for Channel ${pack.channelId}.`,
    `LOCKED TRAITS: ${JSON.stringify(pack.lockedTraits)}.`,
    "PRESERVE IDENTITY: face identity, facial structure, skin tone, base hairstyle, body proportions, body build, age appearance, distinctive traits and core character design language.",
    `ALLOWED SCENE VARIATIONS ONLY: ${pack.allowedVariations.join(", ") || "none"}.`,
    `NEGATIVE IDENTITY RULES: ${pack.negativeRules.join("; ") || "Do not invent or replace the main character."}`,
    "APPLY SCENE APPEARANCE: use only the outfit, shoes, accessories, props, emotion, pose and temporary condition explicitly required by this scene.",
  ].join("\n");
}

export function selectCharacterReferences(pack: CharacterIdentityPackSummary, requestedRole: string) {
  const active = pack.referenceImages.filter(reference => reference.active);
  const exact = active.filter(reference => reference.viewRole.toLowerCase() === requestedRole.toLowerCase());
  if (exact.length) return exact;
  const fallbackRoles = requestedRole.toLowerCase().includes("profile") ? ["three_quarter", "front", "full_body"] : requestedRole.toLowerCase().includes("body") ? ["front", "three_quarter"] : ["front", "three_quarter", "full_body"];
  return [...fallbackRoles.flatMap(role => active.filter(reference => reference.viewRole.toLowerCase() === role)), ...active].filter((reference, index, all) => all.findIndex(item => item.assetId === reference.assetId) === index);
}

export async function saveCharacterIdentityPack(channelId: string, userId: string, input: CharacterIdentityPackInput) {
  await ensureCharacterIdentityStorage();
  const pack = await ensureChannelCharacterIdentityPack(channelId, userId);
  if (!pack) throw new AppError("CHANNEL_NOT_FOUND", "Không tìm thấy Channel.", 404);
  const styleType = input.styleType && CHARACTER_IDENTITY_STYLE_TYPES.includes(input.styleType as typeof CHARACTER_IDENTITY_STYLE_TYPES[number]) ? input.styleType : pack.styleType;
  return db.characterIdentityPack.update({ where: { channelId }, data: { ...(input.name ? { name: input.name.trim() } : {}), styleType, ...(input.lockedTraits ? { lockedTraits: input.lockedTraits as Prisma.InputJsonValue } : {}), ...(input.allowedVariations ? { allowedVariations: input.allowedVariations as Prisma.InputJsonValue } : {}), ...(input.negativeRules ? { negativeRules: input.negativeRules as Prisma.InputJsonValue } : {}) }, include: { referenceImages: { where: { active: true }, orderBy: { createdAt: "asc" } } } });
}
