import type { Program } from "./types";

export const PROGRAM_PREFERENCES_VERSION = 1 as const;
export const PROGRAM_PREFERENCES_STORAGE_KEY =
  "aotu-desktop-program-preferences-v1";

export type ProgramSort =
  | "platform"
  | "latest-desc"
  | "latest-asc"
  | "name"
  | "episode-count";

export type ProgramPreferences = {
  version: typeof PROGRAM_PREFERENCES_VERSION;
  pinnedIds: string[];
  sort: ProgramSort;
};

export const DEFAULT_PROGRAM_PREFERENCES: ProgramPreferences = {
  version: PROGRAM_PREFERENCES_VERSION,
  pinnedIds: [],
  sort: "platform",
};

const PROGRAM_SORTS = new Set<ProgramSort>([
  "platform",
  "latest-desc",
  "latest-asc",
  "name",
  "episode-count",
]);

function defaultPreferences(): ProgramPreferences {
  return {
    ...DEFAULT_PROGRAM_PREFERENCES,
    pinnedIds: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isProgramSort(value: unknown): value is ProgramSort {
  return typeof value === "string" && PROGRAM_SORTS.has(value as ProgramSort);
}

function uniqueStringIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const ids: string[] = [];

  for (const candidate of value) {
    if (
      typeof candidate !== "string" ||
      candidate.length === 0 ||
      seen.has(candidate)
    ) {
      continue;
    }

    seen.add(candidate);
    ids.push(candidate);
  }

  return ids;
}

function normalizePreferences(value: unknown): ProgramPreferences | null {
  if (
    !isRecord(value) ||
    value.version !== PROGRAM_PREFERENCES_VERSION ||
    !isProgramSort(value.sort)
  ) {
    return null;
  }

  return {
    version: PROGRAM_PREFERENCES_VERSION,
    pinnedIds: uniqueStringIds(value.pinnedIds),
    sort: value.sort,
  };
}

export function parseProgramPreferences(
  serialized: string | null | undefined,
): ProgramPreferences {
  if (!serialized) return defaultPreferences();

  try {
    return normalizePreferences(JSON.parse(serialized)) ?? defaultPreferences();
  } catch {
    return defaultPreferences();
  }
}

export function serializeProgramPreferences(
  preferences: ProgramPreferences,
): string {
  return JSON.stringify(normalizePreferences(preferences) ?? defaultPreferences());
}

function latestTimestamp(program: Program): number | null {
  return typeof program.latestEpisodeAt === "number" &&
    Number.isFinite(program.latestEpisodeAt) &&
    program.latestEpisodeAt > 0
    ? program.latestEpisodeAt
    : null;
}

function compareLatest(
  left: Program,
  right: Program,
  direction: "asc" | "desc",
): number {
  const leftTimestamp = latestTimestamp(left);
  const rightTimestamp = latestTimestamp(right);

  if (leftTimestamp === null) return rightTimestamp === null ? 0 : 1;
  if (rightTimestamp === null) return -1;

  return direction === "desc"
    ? rightTimestamp - leftTimestamp
    : leftTimestamp - rightTimestamp;
}

function episodeCount(program: Program): number {
  return typeof program.episodeCount === "number" &&
    Number.isFinite(program.episodeCount)
    ? program.episodeCount
    : 0;
}

function comparePrograms(
  left: Program,
  right: Program,
  sort: ProgramSort,
): number {
  switch (sort) {
    case "latest-desc":
      return compareLatest(left, right, "desc");
    case "latest-asc":
      return compareLatest(left, right, "asc");
    case "name":
      return left.title.localeCompare(right.title, "zh-CN");
    case "episode-count":
      return episodeCount(right) - episodeCount(left);
    case "platform":
      return 0;
  }
}

export function sortPrograms<T extends Program>(
  programs: readonly T[],
  pinnedIds: readonly string[],
  sort: ProgramSort,
): T[] {
  const pinned = new Set(
    pinnedIds.filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    ),
  );
  const effectiveSort = isProgramSort(sort) ? sort : "platform";
  const indexed = programs.map((program, index) => ({ program, index }));

  const stableSort = (items: typeof indexed) =>
    items.sort(
      (left, right) =>
        comparePrograms(left.program, right.program, effectiveSort) ||
        left.index - right.index,
    );

  return [
    ...stableSort(indexed.filter(({ program }) => pinned.has(program.id))),
    ...stableSort(indexed.filter(({ program }) => !pinned.has(program.id))),
  ].map(({ program }) => program);
}
