import type { Episode } from "./types";

export const FAVORITES_VERSION = 1 as const;
export const FAVORITES_STORAGE_KEY = "aotu-desktop-favorites-v1";

export type FavoriteCategory = {
  id: string;
  name: string;
  createdAt: number;
};

export type FavoriteEpisode = Omit<Episode, "audioUrl"> & {
  savedAt: number;
  categoryIds: string[];
};

export type FavoriteLibrary = {
  version: typeof FAVORITES_VERSION;
  items: FavoriteEpisode[];
  categories: FavoriteCategory[];
};

export const EMPTY_FAVORITE_LIBRARY: FavoriteLibrary = {
  version: FAVORITES_VERSION,
  items: [],
  categories: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => (
    typeof item === "string" && item.length > 0
  )))];
}

function normalizeLibrary(value: unknown): FavoriteLibrary | null {
  if (
    !isRecord(value) ||
    value.version !== FAVORITES_VERSION ||
    !Array.isArray(value.items) ||
    !Array.isArray(value.categories)
  ) {
    return null;
  }

  const categories = value.categories
    .filter((category): category is Record<string, unknown> => (
      isRecord(category) &&
      typeof category.id === "string" &&
      category.id.length > 0 &&
      typeof category.name === "string" &&
      category.name.trim().length > 0
    ))
    .map<FavoriteCategory>((category) => ({
      id: category.id as string,
      name: String(category.name).trim().slice(0, 24),
      createdAt: Number.isFinite(category.createdAt)
        ? Number(category.createdAt)
        : 0,
    }));
  const categoryIds = new Set(categories.map((category) => category.id));

  const seen = new Set<string>();
  const items = value.items
    .filter((item): item is Record<string, unknown> => (
      isRecord(item) &&
      typeof item.id === "string" &&
      item.id.length > 0 &&
      typeof item.title === "string" &&
      item.title.length > 0 &&
      !seen.has(item.id) &&
      (seen.add(item.id), true)
    ))
    .map<FavoriteEpisode>((item) => ({
      id: item.id as string,
      title: item.title as string,
      ...(typeof item.description === "string"
        ? { description: item.description }
        : {}),
      ...(typeof item.programId === "string"
        ? { programId: item.programId }
        : {}),
      ...(typeof item.programTitle === "string"
        ? { programTitle: item.programTitle }
        : {}),
      ...(typeof item.coverUrl === "string" ? { coverUrl: item.coverUrl } : {}),
      ...(typeof item.duration === "number" && Number.isFinite(item.duration)
        ? { duration: item.duration }
        : {}),
      ...(typeof item.publishedAt === "string"
        ? { publishedAt: item.publishedAt }
        : {}),
      ...(typeof item.isVip === "boolean" ? { isVip: item.isVip } : {}),
      savedAt:
        typeof item.savedAt === "number" && Number.isFinite(item.savedAt)
          ? item.savedAt
          : 0,
      categoryIds: uniqueStrings(item.categoryIds).filter((id) =>
        categoryIds.has(id),
      ),
    }))
    .sort((left, right) => right.savedAt - left.savedAt);

  return {
    version: FAVORITES_VERSION,
    items,
    categories: categories.sort((left, right) => left.createdAt - right.createdAt),
  };
}

function emptyLibrary(): FavoriteLibrary {
  return { ...EMPTY_FAVORITE_LIBRARY, items: [], categories: [] };
}

export function parseFavoriteLibrary(
  serialized: string | null | undefined,
): FavoriteLibrary {
  if (!serialized) return emptyLibrary();
  try {
    return normalizeLibrary(JSON.parse(serialized)) ?? emptyLibrary();
  } catch {
    return emptyLibrary();
  }
}

export function serializeFavoriteLibrary(library: FavoriteLibrary): string {
  return JSON.stringify(normalizeLibrary(library) ?? emptyLibrary());
}

export function addFavorite(
  library: FavoriteLibrary,
  episode: Episode,
  savedAt = Date.now(),
): FavoriteLibrary {
  const existing = library.items.find((item) => item.id === episode.id);
  if (existing) return library;
  const snapshot: Omit<Episode, "audioUrl"> = {
    id: episode.id,
    title: episode.title,
    ...(episode.description ? { description: episode.description } : {}),
    ...(episode.programId ? { programId: episode.programId } : {}),
    ...(episode.programTitle ? { programTitle: episode.programTitle } : {}),
    ...(episode.coverUrl ? { coverUrl: episode.coverUrl } : {}),
    ...(episode.duration !== undefined ? { duration: episode.duration } : {}),
    ...(episode.publishedAt ? { publishedAt: episode.publishedAt } : {}),
    ...(episode.isVip !== undefined ? { isVip: episode.isVip } : {}),
  };
  return {
    ...library,
    items: [
      { ...snapshot, savedAt, categoryIds: [] },
      ...library.items,
    ],
  };
}

export function removeFavorite(
  library: FavoriteLibrary,
  episodeId: string,
): FavoriteLibrary {
  return {
    ...library,
    items: library.items.filter((item) => item.id !== episodeId),
  };
}

export function createFavoriteCategory(
  library: FavoriteLibrary,
  name: string,
  id: string,
  createdAt = Date.now(),
): FavoriteLibrary {
  const normalizedName = name.trim().slice(0, 24);
  if (
    !normalizedName ||
    library.categories.some(
      (category) =>
        category.name.toLocaleLowerCase("zh-CN") ===
        normalizedName.toLocaleLowerCase("zh-CN"),
    )
  ) {
    return library;
  }
  return {
    ...library,
    categories: [
      ...library.categories,
      { id, name: normalizedName, createdAt },
    ],
  };
}

export function setFavoriteCategory(
  library: FavoriteLibrary,
  episodeId: string,
  categoryId: string,
  selected: boolean,
): FavoriteLibrary {
  if (!library.categories.some((category) => category.id === categoryId)) {
    return library;
  }
  return {
    ...library,
    items: library.items.map((item) => {
      if (item.id !== episodeId) return item;
      const ids = new Set(item.categoryIds);
      if (selected) ids.add(categoryId);
      else ids.delete(categoryId);
      return { ...item, categoryIds: [...ids] };
    }),
  };
}
