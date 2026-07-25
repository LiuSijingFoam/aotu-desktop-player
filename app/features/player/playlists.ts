import type { Episode } from "./types";

export const PLAYLISTS_VERSION = 1 as const;
export const PLAYLISTS_STORAGE_KEY = "aotu-desktop-playlists-v1";
export const PLAYLIST_SHARE_VERSION = 1 as const;
export const PLAYLIST_SHARE_PREFIX = "AOTUPL1:";
export const SPECIAL_FAVORITES_PLAYLIST_ID = "special-favorites";
export const MAX_PLAYLISTS = 50;
export const MAX_PLAYLIST_ITEMS = 200;

export type PlaylistEpisode = Omit<Episode, "audioUrl" | "description"> & {
  addedAt: number;
};

export type CustomPlaylist = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  items: PlaylistEpisode[];
};

export type PlaylistLibrary = {
  version: typeof PLAYLISTS_VERSION;
  playlists: CustomPlaylist[];
};

export type PlaylistSharePayload = {
  v: typeof PLAYLIST_SHARE_VERSION;
  n: string;
  i: Array<{
    i: string;
    t: string;
    p?: string;
    g?: string;
    d?: number;
    v?: 1;
  }>;
};

export const EMPTY_PLAYLIST_LIBRARY: PlaylistLibrary = {
  version: PLAYLISTS_VERSION,
  playlists: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : undefined;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function normalizeEpisode(
  value: unknown,
  fallbackAddedAt = 0,
): PlaylistEpisode | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id.trim() ||
    typeof value.title !== "string" ||
    !value.title.trim()
  ) {
    return null;
  }

  return {
    id: value.id.trim().slice(0, 120),
    title: value.title.trim().slice(0, 180),
    ...(optionalText(value.programId, 120)
      ? { programId: optionalText(value.programId, 120) }
      : {}),
    ...(optionalText(value.programTitle, 120)
      ? { programTitle: optionalText(value.programTitle, 120) }
      : {}),
    ...(optionalText(value.coverUrl, 1000)
      ? { coverUrl: optionalText(value.coverUrl, 1000) }
      : {}),
    ...(optionalNumber(value.duration) !== undefined
      ? { duration: optionalNumber(value.duration) }
      : {}),
    ...(optionalText(value.publishedAt, 80)
      ? { publishedAt: optionalText(value.publishedAt, 80) }
      : {}),
    ...(typeof value.isVip === "boolean" ? { isVip: value.isVip } : {}),
    addedAt: optionalNumber(value.addedAt) ?? fallbackAddedAt,
  };
}

function normalizePlaylist(value: unknown): CustomPlaylist | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id.trim() ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    !Array.isArray(value.items)
  ) {
    return null;
  }

  const seen = new Set<string>();
  const items = value.items
    .map((item) => normalizeEpisode(item))
    .filter((item): item is PlaylistEpisode => Boolean(item))
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, MAX_PLAYLIST_ITEMS);
  const createdAt = optionalNumber(value.createdAt) ?? 0;

  return {
    id: value.id.trim().slice(0, 120),
    name: value.name.trim().slice(0, 32),
    createdAt,
    updatedAt: optionalNumber(value.updatedAt) ?? createdAt,
    items,
  };
}

function normalizeLibrary(value: unknown): PlaylistLibrary | null {
  if (
    !isRecord(value) ||
    value.version !== PLAYLISTS_VERSION ||
    !Array.isArray(value.playlists)
  ) {
    return null;
  }

  const seen = new Set<string>();
  const playlists = value.playlists
    .map(normalizePlaylist)
    .filter((playlist): playlist is CustomPlaylist => Boolean(playlist))
    .filter((playlist) => {
      if (seen.has(playlist.id)) return false;
      seen.add(playlist.id);
      return true;
    })
    .slice(0, MAX_PLAYLISTS)
    .sort((left, right) => right.updatedAt - left.updatedAt);

  return { version: PLAYLISTS_VERSION, playlists };
}

function emptyLibrary(): PlaylistLibrary {
  return { ...EMPTY_PLAYLIST_LIBRARY, playlists: [] };
}

function episodeSnapshot(
  episode: Episode,
  addedAt: number,
): PlaylistEpisode {
  return {
    id: episode.id,
    title: episode.title,
    ...(episode.programId ? { programId: episode.programId } : {}),
    ...(episode.programTitle ? { programTitle: episode.programTitle } : {}),
    ...(episode.coverUrl ? { coverUrl: episode.coverUrl } : {}),
    ...(episode.duration !== undefined ? { duration: episode.duration } : {}),
    ...(episode.publishedAt ? { publishedAt: episode.publishedAt } : {}),
    ...(episode.isVip !== undefined ? { isVip: episode.isVip } : {}),
    addedAt,
  };
}

export function parsePlaylistLibrary(
  serialized: string | null | undefined,
): PlaylistLibrary {
  if (!serialized) return emptyLibrary();
  try {
    return normalizeLibrary(JSON.parse(serialized)) ?? emptyLibrary();
  } catch {
    return emptyLibrary();
  }
}

export function serializePlaylistLibrary(library: PlaylistLibrary): string {
  return JSON.stringify(normalizeLibrary(library) ?? emptyLibrary());
}

export function createPlaylist(
  library: PlaylistLibrary,
  name: string,
  id: string,
  createdAt = Date.now(),
): PlaylistLibrary {
  const normalizedName = name.trim().slice(0, 32);
  if (
    !normalizedName ||
    library.playlists.length >= MAX_PLAYLISTS ||
    library.playlists.some((playlist) => playlist.id === id)
  ) {
    return library;
  }
  return {
    ...library,
    playlists: [
      {
        id,
        name: normalizedName,
        createdAt,
        updatedAt: createdAt,
        items: [],
      },
      ...library.playlists,
    ],
  };
}

export function renamePlaylist(
  library: PlaylistLibrary,
  playlistId: string,
  name: string,
  updatedAt = Date.now(),
): PlaylistLibrary {
  const normalizedName = name.trim().slice(0, 32);
  if (!normalizedName) return library;
  return {
    ...library,
    playlists: library.playlists.map((playlist) =>
      playlist.id === playlistId
        ? { ...playlist, name: normalizedName, updatedAt }
        : playlist,
    ),
  };
}

export function deletePlaylist(
  library: PlaylistLibrary,
  playlistId: string,
): PlaylistLibrary {
  return {
    ...library,
    playlists: library.playlists.filter(
      (playlist) => playlist.id !== playlistId,
    ),
  };
}

export function setEpisodeInPlaylist(
  library: PlaylistLibrary,
  playlistId: string,
  episode: Episode,
  selected: boolean,
  updatedAt = Date.now(),
): PlaylistLibrary {
  return {
    ...library,
    playlists: library.playlists.map((playlist) => {
      if (playlist.id !== playlistId) return playlist;
      const alreadyIncluded = playlist.items.some(
        (item) => item.id === episode.id,
      );
      if (alreadyIncluded === selected) return playlist;
      return {
        ...playlist,
        updatedAt,
        items: selected
          ? [
              ...playlist.items,
              episodeSnapshot(episode, updatedAt),
            ].slice(0, MAX_PLAYLIST_ITEMS)
          : playlist.items.filter((item) => item.id !== episode.id),
      };
    }),
  };
}

export function removeEpisodeFromPlaylist(
  library: PlaylistLibrary,
  playlistId: string,
  episodeId: string,
  updatedAt = Date.now(),
): PlaylistLibrary {
  return {
    ...library,
    playlists: library.playlists.map((playlist) =>
      playlist.id === playlistId &&
      playlist.items.some((item) => item.id === episodeId)
        ? {
            ...playlist,
            updatedAt,
            items: playlist.items.filter((item) => item.id !== episodeId),
          }
        : playlist,
    ),
  };
}

export function createPlaylistSharePayload(
  playlist: CustomPlaylist,
): PlaylistSharePayload {
  return {
    v: PLAYLIST_SHARE_VERSION,
    n: playlist.name,
    i: playlist.items.map((episode) => ({
      i: episode.id,
      t: episode.title,
      ...(episode.programId ? { p: episode.programId } : {}),
      ...(episode.programTitle ? { g: episode.programTitle } : {}),
      ...(episode.duration !== undefined ? { d: episode.duration } : {}),
      ...(episode.isVip ? { v: 1 as const } : {}),
    })),
  };
}

export function parsePlaylistSharePayload(
  value: unknown,
): Pick<CustomPlaylist, "name" | "items"> | null {
  if (
    !isRecord(value) ||
    value.v !== PLAYLIST_SHARE_VERSION ||
    typeof value.n !== "string" ||
    !value.n.trim() ||
    !Array.isArray(value.i) ||
    value.i.length > MAX_PLAYLIST_ITEMS
  ) {
    return null;
  }

  const seen = new Set<string>();
  const now = Date.now();
  const items = value.i
    .map((item) => {
      if (!isRecord(item)) return null;
      return normalizeEpisode(
        {
          id: item.i,
          title: item.t,
          programId: item.p,
          programTitle: item.g,
          duration: item.d,
          isVip: item.v === 1,
        },
        now,
      );
    })
    .filter((item): item is PlaylistEpisode => Boolean(item))
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });

  if (items.length !== value.i.length) return null;
  return {
    name: value.n.trim().slice(0, 32),
    items,
  };
}

export function importPlaylist(
  library: PlaylistLibrary,
  shared: Pick<CustomPlaylist, "name" | "items">,
  id: string,
  importedAt = Date.now(),
): PlaylistLibrary {
  if (
    library.playlists.length >= MAX_PLAYLISTS ||
    library.playlists.some((playlist) => playlist.id === id)
  ) {
    return library;
  }

  const existingNames = new Set(
    library.playlists.map((playlist) =>
      playlist.name.toLocaleLowerCase("zh-CN"),
    ),
  );
  let name = shared.name.trim().slice(0, 32) || "导入的播放列表";
  if (existingNames.has(name.toLocaleLowerCase("zh-CN"))) {
    const base = name.slice(0, 26);
    let sequence = 1;
    do {
      name = `${base}（导入${sequence > 1 ? ` ${sequence}` : ""}）`.slice(
        0,
        32,
      );
      sequence += 1;
    } while (existingNames.has(name.toLocaleLowerCase("zh-CN")));
  }

  return {
    ...library,
    playlists: [
      {
        id,
        name,
        createdAt: importedAt,
        updatedAt: importedAt,
        items: shared.items.slice(0, MAX_PLAYLIST_ITEMS).map((item) => ({
          ...item,
          addedAt: importedAt,
        })),
      },
      ...library.playlists,
    ],
  };
}
