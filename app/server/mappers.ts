import type { Episode, Program, Viewer } from "../features/player/types";

type JsonRecord = Record<string, unknown>;

function text(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function imageProxyUrl(value: unknown) {
  const url = text(value);
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return undefined;
    return `/api/image?url=${encodeURIComponent(parsed.toString())}`;
  } catch {
    return undefined;
  }
}

export function toProgram(value: unknown): Program {
  const source = record(value);
  return {
    id: text(source.id),
    title: text(source.name, "未命名节目"),
    description: text(source.desc || source.dec) || undefined,
    coverUrl: imageProxyUrl(source.image || source.w_image),
    isVip: Number(source.is_vip) !== 0,
    episodeCount: number(source.items_count),
    latestEpisodeAt: number(source.last_episode_time),
  };
}

export function toEpisode(
  value: unknown,
  options: { includeAudio?: boolean; audioUrl?: string } = {},
): Episode {
  const source = record(value);
  const broadcast = record(source.broadcast_info);
  const rawAudio = text(source.play_url);
  return {
    id: text(source.id),
    title: text(source.name, "未命名单集"),
    description: text(source.dec) || undefined,
    programId:
      text(broadcast.id || source.broadcasting_id || source.cast_id) ||
      undefined,
    programTitle: text(broadcast.name) || undefined,
    coverUrl: imageProxyUrl(source.image || source.w_image),
    audioUrl:
      options.audioUrl ??
      (options.includeAudio && rawAudio ? rawAudio : undefined),
    duration: number(source.time),
    publishedAt:
      text(source.pubdate || source.createtime_text || source.createtime) ||
      undefined,
    isVip: Number(source.is_vip) !== 0,
  };
}

export function toViewer(value: unknown): Viewer {
  const source = record(value);
  return {
    id: text(source.id || source.user_id),
    nickname: text(source.nickname, "凹凸宇宙会员"),
    avatarUrl: imageProxyUrl(source.avatar),
    isVip: Number(source.is_vip) === 1,
    vipExpiresAt: text(source.vip_end_time_str) || undefined,
  };
}

export function rawId(value: unknown) {
  return text(record(value).id);
}

export function rawPlayUrl(value: unknown) {
  return text(record(value).play_url);
}

export function rawIsVip(value: unknown) {
  return Number(record(value).is_vip) !== 0;
}

export function listFrom(value: unknown, ...path: string[]): unknown[] {
  let current: unknown = value;
  for (const segment of path) current = record(current)[segment];
  return Array.isArray(current) ? current : [];
}

export function recordValue(value: unknown, key: string) {
  return record(value)[key];
}
