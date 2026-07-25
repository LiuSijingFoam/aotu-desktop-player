"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiError, playerApi } from "./api-client";
import { EpisodeDrawer } from "./EpisodeDrawer";
import {
  addFavorite,
  EMPTY_FAVORITE_LIBRARY,
  FAVORITES_STORAGE_KEY,
  groupFavoritesByProgram,
  parseFavoriteLibrary,
  removeFavorite,
  reorderFavoritePrograms,
  serializeFavoriteLibrary,
  type FavoriteLibrary,
} from "./favorites";
import { HeartButton } from "./HeartButton";
import { PlaylistPicker } from "./PlaylistPicker";
import {
  createPlaylist,
  deletePlaylist,
  EMPTY_PLAYLIST_LIBRARY,
  importPlaylist,
  MAX_PLAYLISTS,
  parsePlaylistLibrary,
  PLAYLISTS_STORAGE_KEY,
  removeEpisodeFromPlaylist,
  renamePlaylist,
  serializePlaylistLibrary,
  setEpisodeInPlaylist,
  SPECIAL_FAVORITES_PLAYLIST_ID,
  type CustomPlaylist,
  type PlaylistLibrary,
} from "./playlists";
import { PlaylistWorkspace } from "./PlaylistWorkspace";
import { SpecialFavoritesPlaylist } from "./SpecialFavoritesPlaylist";
import {
  DEFAULT_PROGRAM_PREFERENCES,
  parseProgramPreferences,
  PROGRAM_PREFERENCES_STORAGE_KEY,
  serializeProgramPreferences,
  sortPrograms,
  type ProgramPreferences,
  type ProgramSort,
} from "./program-preferences";
import { ProgramDrawer } from "./ProgramDrawer";
import { UpdateNotice } from "./UpdateNotice";
import type {
  DiscoveryPayload,
  Episode,
  HistoryEntry,
  Program,
  Viewer,
} from "./types";

const HISTORY_KEY = "aotu-desktop-history-v1";
const PROGRESS_INTERVAL = 5;

function createLocalId(prefix: string) {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatDuration(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds)) return "--:--";
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remaining = whole % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function formatDate(value?: string) {
  if (!value) return "最近更新";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) return "暂时无法连接服务，请检查网络后重试。";
  return "发生了意外错误，请稍后再试。";
}

function readHistory(): HistoryEntry[] {
  try {
    const value = localStorage.getItem(HISTORY_KEY);
    if (!value) return [];
    return parseHistory(JSON.parse(value));
  } catch {
    return [];
  }
}

function parseHistory(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is HistoryEntry =>
        Boolean(
          entry &&
            typeof entry === "object" &&
            "id" in entry &&
            typeof entry.id === "string" &&
            "title" in entry &&
            typeof entry.title === "string" &&
            "programId" in entry &&
            typeof entry.programId === "string" &&
            "programTitle" in entry &&
            typeof entry.programTitle === "string",
        ),
    )
    .slice(0, 40);
}

function persistDesktopData(
  key: "history" | "programPreferences" | "favorites" | "playlists",
  value: unknown,
) {
  void window.aotuDesktop?.storage.set(key, value);
}

function readFavoriteLibrary() {
  try {
    return parseFavoriteLibrary(localStorage.getItem(FAVORITES_STORAGE_KEY));
  } catch {
    return {
      ...EMPTY_FAVORITE_LIBRARY,
      items: [],
      categories: [],
      programOrder: [],
    };
  }
}

function writeFavoriteLibrary(library: FavoriteLibrary) {
  const serialized = serializeFavoriteLibrary(library);
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, serialized);
  } catch {
    // The desktop store remains available when browser storage is unavailable.
  }
  persistDesktopData("favorites", serialized);
}

function readPlaylistLibrary() {
  try {
    return parsePlaylistLibrary(localStorage.getItem(PLAYLISTS_STORAGE_KEY));
  } catch {
    return { ...EMPTY_PLAYLIST_LIBRARY, playlists: [] };
  }
}

function writePlaylistLibrary(library: PlaylistLibrary) {
  const serialized = serializePlaylistLibrary(library);
  try {
    localStorage.setItem(PLAYLISTS_STORAGE_KEY, serialized);
  } catch {
    // The desktop store remains available when browser storage is unavailable.
  }
  persistDesktopData("playlists", serialized);
}

function readProgramPreferences() {
  try {
    return parseProgramPreferences(
      localStorage.getItem(PROGRAM_PREFERENCES_STORAGE_KEY),
    );
  } catch {
    return { ...DEFAULT_PROGRAM_PREFERENCES, pinnedIds: [] };
  }
}

function writeProgramPreferences(preferences: ProgramPreferences) {
  const serialized = serializeProgramPreferences(preferences);
  try {
    localStorage.setItem(PROGRAM_PREFERENCES_STORAGE_KEY, serialized);
  } catch {
    // Private browsing or a full storage quota should not block playback.
  }
  persistDesktopData("programPreferences", serialized);
}

function Cover({
  src,
  title,
  className = "",
}: {
  src?: string;
  title: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={`cover-fallback ${className}`} aria-label={title}>
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
    );
  }
  return (
    // Dynamic cover art comes from the authenticated upstream catalog.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function HeroArtwork({ program }: { program: Program | null }) {
  const [failedSrc, setFailedSrc] = useState("");
  const coverUrl = program?.coverUrl;

  if (coverUrl && failedSrc !== coverUrl) {
    return (
      // Hero artwork is the selected program's catalog cover.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="hero-cover"
        src={coverUrl}
        alt=""
        loading="eager"
        decoding="async"
        onError={() => setFailedSrc(coverUrl)}
      />
    );
  }

  return (
    <div className="hero-disc">
      <span />
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="episode-list" aria-label="正在加载节目">
      {[0, 1, 2, 3].map((item) => (
        <div className="episode-row episode-skeleton" key={item}>
          <div className="skeleton-block" />
          <div className="skeleton-lines">
            <span />
            <span />
          </div>
        </div>
      ))}
    </div>
  );
}

function LoginDialog({
  busy,
  message,
  cooldown,
  onClose,
  onSendCode,
  onLogin,
}: {
  busy: boolean;
  message: string;
  cooldown: number;
  onClose: () => void;
  onSendCode: (mobile: string) => Promise<void>;
  onLogin: (mobile: string, code: string) => Promise<void>;
}) {
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [formError, setFormError] = useState("");

  const validateMobile = () => {
    if (!/^1\d{10}$/.test(mobile)) {
      setFormError("请输入手机号。");
      return false;
    }
    setFormError("");
    return true;
  };

  const sendCode = async () => {
    if (!validateMobile()) return;
    await onSendCode(mobile);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validateMobile()) return;
    if (!/^\d{4,8}$/.test(code)) {
      setFormError("请输入短信中的验证码。");
      return;
    }
    await onLogin(mobile, code);
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="login-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="dialog-close" type="button" onClick={onClose}>
          关闭
        </button>
        <div className="eyebrow">会员登录</div>
        <h2 id="login-title">在电脑上继续听</h2>
        <p className="dialog-copy">
          验证码由凹凸宇宙官方服务发送。
        </p>
        <form className="login-form" onSubmit={submit}>
          <label>
            <span>手机号</span>
            <input
              autoComplete="tel"
              inputMode="numeric"
              maxLength={11}
              placeholder="请输入会员绑定手机号"
              value={mobile}
              onChange={(event) =>
                setMobile(event.target.value.replace(/\D/g, ""))
              }
            />
          </label>
          <label>
            <span>短信验证码</span>
            <div className="code-field">
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={8}
                placeholder="验证码"
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, ""))
                }
              />
              <button
                type="button"
                disabled={busy || cooldown > 0}
                onClick={sendCode}
              >
                {cooldown > 0 ? `${cooldown} 秒` : "发送验证码"}
              </button>
            </div>
          </label>
          {(formError || message) && (
            <p className="form-message" role="alert">
              {formError || message}
            </p>
          )}
          <button className="primary-button login-submit" disabled={busy}>
            {busy ? "正在验证…" : "登录并读取会员节目"}
          </button>
        </form>
        <p className="privacy-note">
          调用官方登录和会员校验。
        </p>
      </section>
    </div>
  );
}

export function PlayerApp() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastSavedRef = useRef(0);
  const programRequestRef = useRef(0);
  const autoplayEpisodeIdRef = useRef("");
  const autoplayInFlightRef = useRef(false);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [discovery, setDiscovery] = useState<DiscoveryPayload>({
    programs: [],
    episodes: [],
    source: "public",
  });
  const [contentLoading, setContentLoading] = useState(true);
  const [contentError, setContentError] = useState("");
  const [activeProgram, setActiveProgram] = useState<Program | null>(null);
  const [programEpisodes, setProgramEpisodes] = useState<Episode[]>([]);
  const [programLoading, setProgramLoading] = useState(false);
  const [programLoadingMore, setProgramLoadingMore] = useState(false);
  const [programError, setProgramError] = useState("");
  const [programPage, setProgramPage] = useState(1);
  const [programHasMore, setProgramHasMore] = useState(false);
  const [programTotal, setProgramTotal] = useState<number | undefined>();
  const [episodeDrawerOpen, setEpisodeDrawerOpen] = useState(false);
  const [programDrawerOpen, setProgramDrawerOpen] = useState(false);
  const [programPreferences, setProgramPreferences] =
    useState<ProgramPreferences>({
      ...DEFAULT_PROGRAM_PREFERENCES,
      pinnedIds: [],
    });
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchPrograms, setSearchPrograms] = useState<Program[]>([]);
  const [searchEpisodes, setSearchEpisodes] = useState<Episode[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [favoriteLibrary, setFavoriteLibrary] = useState<FavoriteLibrary>({
    ...EMPTY_FAVORITE_LIBRARY,
    items: [],
    categories: [],
    programOrder: [],
  });
  const [playlistLibrary, setPlaylistLibrary] = useState<PlaylistLibrary>({
    ...EMPTY_PLAYLIST_LIBRARY,
    playlists: [],
  });
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(
    SPECIAL_FAVORITES_PLAYLIST_ID,
  );
  const [playlistPickerEpisode, setPlaylistPickerEpisode] =
    useState<Episode | null>(null);
  const [playlistImporting, setPlaylistImporting] = useState(false);
  const [playlistExportingId, setPlaylistExportingId] = useState("");
  const [activeQueue, setActiveQueue] = useState<{
    playlistId: string;
    episodeIds: string[];
  } | null>(null);
  const [favoriteCategoryFilter, setFavoriteCategoryFilter] = useState("all");
  const [view, setView] =
    useState<"discover" | "history" | "playlists">("discover");
  const [current, setCurrent] = useState<Episode | null>(null);
  const [playerBusyId, setPlayerBusyId] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [speed, setSpeed] = useState(1);
  const [notice, setNotice] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginMessage, setLoginMessage] = useState("");
  const [cooldown, setCooldown] = useState(0);

  const loadDiscovery = useCallback(async () => {
    setContentLoading(true);
    setContentError("");
    try {
      setDiscovery(await playerApi.discovery());
    } catch (error) {
      setContentError(errorMessage(error));
    } finally {
      setContentLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(async () => {
      const localHistory = readHistory();
      const localPreferences = readProgramPreferences();
      const localFavorites = readFavoriteLibrary();
      const localPlaylists = readPlaylistLibrary();
      const storage = window.aotuDesktop?.storage;
      if (!storage) {
        setHistory(localHistory);
        setProgramPreferences(localPreferences);
        setFavoriteLibrary(localFavorites);
        setPlaylistLibrary(localPlaylists);
        return;
      }

      try {
        const [
          storedHistory,
          storedPreferences,
          storedFavorites,
          storedPlaylists,
        ] =
          await Promise.all([
          storage.get<unknown>("history"),
          storage.get<unknown>("programPreferences"),
          storage.get<unknown>("favorites"),
          storage.get<unknown>("playlists"),
        ]);
        const nextHistory =
          storedHistory === null ? localHistory : parseHistory(storedHistory);
        const nextPreferences =
          typeof storedPreferences === "string"
            ? parseProgramPreferences(storedPreferences)
            : localPreferences;
        const nextFavorites =
          typeof storedFavorites === "string"
            ? parseFavoriteLibrary(storedFavorites)
            : localFavorites;
        const nextPlaylists =
          typeof storedPlaylists === "string"
            ? parsePlaylistLibrary(storedPlaylists)
            : localPlaylists;

        setHistory(nextHistory);
        setProgramPreferences(nextPreferences);
        setFavoriteLibrary(nextFavorites);
        setPlaylistLibrary(nextPlaylists);
        if (storedHistory === null && localHistory.length > 0) {
          persistDesktopData("history", localHistory);
        }
        if (storedPreferences === null) {
          persistDesktopData(
            "programPreferences",
            serializeProgramPreferences(localPreferences),
          );
        }
        if (storedFavorites === null) {
          persistDesktopData(
            "favorites",
            serializeFavoriteLibrary(localFavorites),
          );
        }
        if (storedPlaylists === null) {
          persistDesktopData(
            "playlists",
            serializePlaylistLibrary(localPlaylists),
          );
        }
      } catch {
        setHistory(localHistory);
        setProgramPreferences(localPreferences);
        setFavoriteLibrary(localFavorites);
        setPlaylistLibrary(localPlaylists);
      }
    });
    Promise.allSettled([playerApi.session(), playerApi.discovery()]).then(
      ([sessionResult, discoveryResult]) => {
        if (sessionResult.status === "fulfilled") {
          setViewer(sessionResult.value.viewer ?? null);
        }
        if (discoveryResult.status === "fulfilled") {
          setDiscovery(discoveryResult.value);
        } else {
          setContentError(errorMessage(discoveryResult.reason));
        }
        setSessionLoading(false);
        setContentLoading(false);
      },
    );
  }, []);

  const toggleProgramPin = useCallback((programId: string) => {
    setProgramPreferences((currentPreferences) => {
      const isPinned = currentPreferences.pinnedIds.includes(programId);
      const nextPreferences: ProgramPreferences = {
        ...currentPreferences,
        pinnedIds: isPinned
          ? currentPreferences.pinnedIds.filter((id) => id !== programId)
          : [
              programId,
              ...currentPreferences.pinnedIds.filter((id) => id !== programId),
            ],
      };
      writeProgramPreferences(nextPreferences);
      return nextPreferences;
    });
  }, []);

  const changeProgramSort = useCallback((sort: ProgramSort) => {
    setProgramPreferences((currentPreferences) => {
      const nextPreferences: ProgramPreferences = {
        ...currentPreferences,
        sort,
      };
      writeProgramPreferences(nextPreferences);
      return nextPreferences;
    });
  }, []);

  const updateFavoriteLibrary = useCallback(
    (update: (library: FavoriteLibrary) => FavoriteLibrary) => {
      setFavoriteLibrary((library) => {
        const next = update(library);
        writeFavoriteLibrary(next);
        return next;
      });
    },
    [],
  );

  const toggleSpecialFavorite = useCallback(
    (episode: Episode) => {
      const alreadySaved = favoriteLibrary.items.some(
        (item) => item.id === episode.id,
      );
      const resolvedProgramTitle =
        episode.programTitle ??
        discovery.programs.find(
          (program) => program.id === episode.programId,
        )?.title;
      const favoriteEpisode =
        resolvedProgramTitle && !episode.programTitle
          ? { ...episode, programTitle: resolvedProgramTitle }
          : episode;
      updateFavoriteLibrary((library) =>
        alreadySaved
          ? removeFavorite(library, episode.id)
          : addFavorite(library, favoriteEpisode),
      );
      if (alreadySaved) {
        setActiveQueue((queue) =>
          queue?.playlistId === SPECIAL_FAVORITES_PLAYLIST_ID
            ? {
                ...queue,
                episodeIds: queue.episodeIds.filter(
                  (episodeId) => episodeId !== episode.id,
                ),
              }
            : queue,
        );
      }
      setNotice(
        alreadySaved ? "已从特别收藏中移出。" : "已加入特别收藏。",
      );
    },
    [discovery.programs, favoriteLibrary.items, updateFavoriteLibrary],
  );

  const moveFavoriteProgram = useCallback(
    (
      sourceId: string,
      targetId: string,
      position: "before" | "after",
    ) => {
      updateFavoriteLibrary((library) =>
        reorderFavoritePrograms(library, sourceId, targetId, position),
      );
    },
    [updateFavoriteLibrary],
  );

  const updatePlaylistLibrary = useCallback(
    (update: (library: PlaylistLibrary) => PlaylistLibrary) => {
      setPlaylistLibrary((library) => {
        const next = update(library);
        writePlaylistLibrary(next);
        return next;
      });
    },
    [],
  );

  const createNewPlaylist = useCallback(
    (name: string, initialEpisode?: Episode) => {
      const normalized = name.trim();
      if (!normalized) return;
      if (playlistLibrary.playlists.length >= MAX_PLAYLISTS) {
        setNotice(`最多可创建 ${MAX_PLAYLISTS} 个播放列表。`);
        return;
      }
      const id = createLocalId("playlist");
      updatePlaylistLibrary((library) => {
        const created = createPlaylist(library, normalized, id);
        return initialEpisode
          ? setEpisodeInPlaylist(created, id, initialEpisode, true)
          : created;
      });
      setSelectedPlaylistId(id);
      setNotice(
        initialEpisode
          ? `已新建“${normalized.slice(0, 32)}”并加入节目。`
          : `已创建播放列表“${normalized.slice(0, 32)}”。`,
      );
    },
    [playlistLibrary.playlists.length, updatePlaylistLibrary],
  );

  const toggleEpisodePlaylist = useCallback(
    (playlistId: string, episode: Episode, selected: boolean) => {
      updatePlaylistLibrary((library) =>
        setEpisodeInPlaylist(library, playlistId, episode, selected),
      );
      setActiveQueue((queue) =>
        !selected && queue?.playlistId === playlistId
          ? {
              ...queue,
              episodeIds: queue.episodeIds.filter((id) => id !== episode.id),
            }
          : queue,
      );
      const playlist = playlistLibrary.playlists.find(
        (item) => item.id === playlistId,
      );
      setNotice(
        `${selected ? "已加入" : "已移出"}“${playlist?.name ?? "播放列表"}”。`,
      );
    },
    [playlistLibrary.playlists, updatePlaylistLibrary],
  );

  const removePlaylistEpisode = useCallback(
    (playlistId: string, episodeId: string) => {
      updatePlaylistLibrary((library) =>
        removeEpisodeFromPlaylist(library, playlistId, episodeId),
      );
      setActiveQueue((queue) =>
        queue?.playlistId === playlistId
          ? {
              ...queue,
              episodeIds: queue.episodeIds.filter((id) => id !== episodeId),
            }
          : queue,
      );
      setNotice("已从播放列表中移除。");
    },
    [updatePlaylistLibrary],
  );

  const renameCustomPlaylist = useCallback(
    (playlistId: string, name: string) => {
      updatePlaylistLibrary((library) =>
        renamePlaylist(library, playlistId, name),
      );
      setNotice("播放列表已重命名。");
    },
    [updatePlaylistLibrary],
  );

  const removeCustomPlaylist = useCallback(
    (playlist: CustomPlaylist) => {
      if (!window.confirm(`确定删除播放列表“${playlist.name}”吗？`)) return;
      updatePlaylistLibrary((library) =>
        deletePlaylist(library, playlist.id),
      );
      setActiveQueue((queue) =>
        queue?.playlistId === playlist.id ? null : queue,
      );
      setSelectedPlaylistId((currentId) =>
        currentId === playlist.id
          ? SPECIAL_FAVORITES_PLAYLIST_ID
          : currentId,
      );
      setNotice(`已删除“${playlist.name}”。`);
    },
    [updatePlaylistLibrary],
  );

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(
      () => setCooldown((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const result = await playerApi.search(trimmed);
        if (active) {
          setSearchPrograms(result.programs);
          setSearchEpisodes(result.episodes);
        }
      } catch (error) {
        if (active) setNotice(errorMessage(error));
      } finally {
        if (active) setSearching(false);
      }
    }, 380);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const persistHistory = useCallback(
    (episode: Episode, position: number, mediaDuration: number) => {
      const entry: HistoryEntry = {
        id: episode.id,
        title: episode.title,
        programId: episode.programId,
        programTitle: episode.programTitle,
        coverUrl: episode.coverUrl,
        duration: mediaDuration || episode.duration,
        isVip: episode.isVip,
        position,
        playedAt: Date.now(),
      };
      setHistory((existing) => {
        const next = [entry, ...existing.filter((item) => item.id !== entry.id)].slice(
          0,
          40,
        );
        try {
          localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
        } catch {
          // The desktop store remains the durable source when web storage fails.
        }
        persistDesktopData("history", next);
        return next;
      });
    },
    [],
  );

  const beginPlayback = useCallback(
    async (episode: Episode, options?: { preserveQueue?: boolean }) => {
      if (!options?.preserveQueue) setActiveQueue(null);
      const audio = audioRef.current;
      if (current?.id === episode.id && audio) {
        if (audio.paused) {
          await audio.play().catch(() => setNotice("点击播放器中的播放键继续。"));
        } else {
          audio.pause();
        }
        return;
      }

      autoplayEpisodeIdRef.current = episode.id;
      setPlayerBusyId(episode.id);
      try {
        const resolved = episode.audioUrl
          ? episode
          : (await playerApi.episode(episode.id)).episode;
        if (autoplayEpisodeIdRef.current !== episode.id) return;
        if (!resolved.audioUrl) {
          throw new ApiError(409, "AUDIO_UNAVAILABLE", "该节目的音频地址暂不可用。");
        }

        lastSavedRef.current = 0;
        setCurrent(resolved);
        setCurrentTime(0);
        setDuration(resolved.duration ?? 0);
      } catch (error) {
        if (autoplayEpisodeIdRef.current === episode.id) {
          autoplayEpisodeIdRef.current = "";
        }
        if (error instanceof ApiError && [401, 403].includes(error.status)) {
          setLoginMessage("请先登录会员账号，再播放这期节目。");
          setLoginOpen(true);
        } else {
          setNotice(errorMessage(error));
        }
      } finally {
        setPlayerBusyId("");
      }
    },
    [current],
  );

  const playCustomPlaylist = useCallback(
    (playlist: CustomPlaylist) => {
      if (playlist.items.length === 0) {
        setNotice("这个播放列表还没有节目。");
        return;
      }
      setActiveQueue({
        playlistId: playlist.id,
        episodeIds: playlist.items.map((episode) => episode.id),
      });
      setSelectedPlaylistId(playlist.id);
      void beginPlayback(playlist.items[0], { preserveQueue: true });
    },
    [beginPlayback],
  );

  const playNextInQueue = useCallback(() => {
    if (!activeQueue || !current) return;
    const playlistEpisodes =
      activeQueue.playlistId === SPECIAL_FAVORITES_PLAYLIST_ID
        ? favoriteLibrary.items
        : playlistLibrary.playlists.find(
            (item) => item.id === activeQueue.playlistId,
          )?.items;
    const currentIndex = activeQueue.episodeIds.indexOf(current.id);
    const nextId = activeQueue.episodeIds[currentIndex + 1];
    const nextEpisode = playlistEpisodes?.find((item) => item.id === nextId);
    if (!nextEpisode) {
      setActiveQueue(null);
      return;
    }
    void beginPlayback(nextEpisode, { preserveQueue: true });
  }, [
    activeQueue,
    beginPlayback,
    current,
    favoriteLibrary.items,
    playlistLibrary.playlists,
  ]);

  const exportCustomPlaylist = useCallback(
    async (playlist: CustomPlaylist) => {
      setPlaylistExportingId(playlist.id);
      try {
        const { exportPlaylistImage } = await import("./playlist-image");
        await exportPlaylistImage(playlist);
        setNotice("播放列表图片已导出，二维码位于图片底部。");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : errorMessage(error));
      } finally {
        setPlaylistExportingId("");
      }
    },
    [],
  );

  const importCustomPlaylist = useCallback(
    async (file: File) => {
      if (playlistLibrary.playlists.length >= MAX_PLAYLISTS) {
        setNotice(`最多可保存 ${MAX_PLAYLISTS} 个播放列表。`);
        return;
      }
      setPlaylistImporting(true);
      try {
        const { importPlaylistImage } = await import("./playlist-image");
        const shared = await importPlaylistImage(file);
        const id = createLocalId("playlist-import");
        updatePlaylistLibrary((library) =>
          importPlaylist(library, shared, id),
        );
        setSelectedPlaylistId(id);
        setView("playlists");
        setNotice(
          `已从图片导入“${shared.name}”，共 ${shared.items.length} 期节目。`,
        );
      } catch (error) {
        setNotice(error instanceof Error ? error.message : errorMessage(error));
      } finally {
        setPlaylistImporting(false);
      }
    },
    [playlistLibrary.playlists.length, updatePlaylistLibrary],
  );

  const clearProgramContext = useCallback(() => {
    programRequestRef.current += 1;
    setActiveProgram(null);
    setProgramEpisodes([]);
    setProgramLoading(false);
    setProgramLoadingMore(false);
    setProgramError("");
    setProgramPage(1);
    setProgramHasMore(false);
    setProgramTotal(undefined);
    setEpisodeDrawerOpen(false);
    setProgramDrawerOpen(false);
  }, []);

  const selectProgram = async (program: Program) => {
    const requestId = programRequestRef.current + 1;
    programRequestRef.current = requestId;
    setView("discover");
    setQuery("");
    setSearching(false);
    setSearchPrograms([]);
    setSearchEpisodes([]);
    setActiveProgram(program);
    setProgramDrawerOpen(false);
    setEpisodeDrawerOpen(true);
    setProgramLoading(true);
    setProgramLoadingMore(false);
    setProgramError("");
    setProgramPage(1);
    setProgramHasMore(false);
    setProgramTotal(program.episodeCount);
    setProgramEpisodes([]);
    try {
      const result = await playerApi.program(program.id, 1);
      if (programRequestRef.current !== requestId) return;
      setActiveProgram(result.program);
      setProgramEpisodes(result.episodes);
      setProgramPage(result.pagination.page);
      setProgramHasMore(result.pagination.hasMore);
      setProgramTotal(result.pagination.total);
    } catch (error) {
      if (programRequestRef.current === requestId) {
        setProgramError(errorMessage(error));
      }
    } finally {
      if (programRequestRef.current === requestId) {
        setProgramLoading(false);
      }
    }
  };

  const loadMoreProgramEpisodes = async () => {
    if (!activeProgram || !programHasMore || programLoadingMore) return;
    const requestId = programRequestRef.current;
    const nextPage = programPage + 1;
    setProgramLoadingMore(true);
    setProgramError("");
    try {
      const result = await playerApi.program(activeProgram.id, nextPage);
      if (programRequestRef.current !== requestId) return;
      const existingIds = new Set(programEpisodes.map((episode) => episode.id));
      const nextEpisodes = result.episodes.filter(
        (episode) => !existingIds.has(episode.id),
      );
      setProgramEpisodes((existing) => [...existing, ...nextEpisodes]);
      setProgramPage(result.pagination.page);
      setProgramTotal(result.pagination.total);
      setProgramHasMore(
        nextEpisodes.length > 0 && result.pagination.hasMore,
      );
    } catch (error) {
      if (programRequestRef.current === requestId) {
        setNotice(`更多节目载入失败：${errorMessage(error)}`);
      }
    } finally {
      if (programRequestRef.current === requestId) {
        setProgramLoadingMore(false);
      }
    }
  };

  const openEpisodeDrawer = () => {
    if (activeProgram) {
      setProgramDrawerOpen(false);
      setEpisodeDrawerOpen(true);
      return;
    }
    if (!current?.programId) return;
    void selectProgram({
      id: current.programId,
      title: current.programTitle ?? "当前节目",
      coverUrl: current.coverUrl,
    });
  };

  const openProgramDrawer = () => {
    setEpisodeDrawerOpen(false);
    setProgramDrawerOpen(true);
  };

  const sendCode = async (mobile: string) => {
    setLoginBusy(true);
    setLoginMessage("");
    try {
      const result = await playerApi.sendCode(mobile);
      setCooldown(result.cooldown || 60);
      setLoginMessage("验证码已发送，请查看手机短信。");
    } catch (error) {
      setLoginMessage(errorMessage(error));
    } finally {
      setLoginBusy(false);
    }
  };

  const login = async (mobile: string, code: string) => {
    setLoginBusy(true);
    setLoginMessage("");
    try {
      const result = await playerApi.login(mobile, code);
      setViewer(result.viewer ?? null);
      setLoginOpen(false);
      setNotice(result.viewer?.isVip ? "会员账号已连接。" : "账号已登录。");
      await loadDiscovery();
    } catch (error) {
      setLoginMessage(errorMessage(error));
    } finally {
      setLoginBusy(false);
    }
  };

  const logout = async () => {
    try {
      await playerApi.logout();
      setViewer(null);
      clearProgramContext();
      setNotice("已安全退出。");
      await loadDiscovery();
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };

  const displayPrograms = query.trim().length >= 2
    ? searchPrograms
    : discovery.programs;
  const featuredPrograms =
    query.trim().length >= 2
      ? displayPrograms
      : sortPrograms(
          displayPrograms,
          programPreferences.pinnedIds,
          "platform",
        ).slice(0, 4);
  const displayEpisodes = useMemo(() => {
    if (view === "history") {
      return history.map<Episode>((item) => ({
        id: item.id,
        title: item.title,
        programId: item.programId,
        programTitle: item.programTitle,
        coverUrl: item.coverUrl,
        duration: item.duration,
        isVip: item.isVip,
      }));
    }
    if (query.trim().length >= 2) return searchEpisodes;
    if (activeProgram) return programEpisodes;
    return discovery.episodes;
  }, [
    activeProgram,
    discovery.episodes,
    history,
    programEpisodes,
    query,
    searchEpisodes,
    view,
  ]);

  const heroProgram = activeProgram ?? displayPrograms[0] ?? null;
  const pageTitle =
    view === "history"
      ? "最近收听"
      : view === "playlists"
        ? "播放列表"
      : query.trim().length >= 2
        ? `搜索“${query.trim()}”`
        : activeProgram?.title ?? "今天，听点有意思的";
  const favoriteIds = useMemo(
    () => new Set(favoriteLibrary.items.map((item) => item.id)),
    [favoriteLibrary.items],
  );
  const programTitlesById = useMemo(
    () =>
      new Map(
        discovery.programs.map((program) => [program.id, program.title]),
      ),
    [discovery.programs],
  );
  const resolvedFavoriteItems = useMemo(
    () =>
      favoriteLibrary.items.map((item) => {
        const resolvedProgramTitle =
          item.programTitle ||
          (item.programId
            ? programTitlesById.get(item.programId)
            : undefined);
        return resolvedProgramTitle && !item.programTitle
          ? { ...item, programTitle: resolvedProgramTitle }
          : item;
      }),
    [favoriteLibrary.items, programTitlesById],
  );
  const specialFavoritesPlaylist = useMemo<CustomPlaylist>(
    () => ({
      id: SPECIAL_FAVORITES_PLAYLIST_ID,
      name: "特别收藏",
      createdAt: 0,
      updatedAt: favoriteLibrary.items.reduce(
        (latest, item) => Math.max(latest, item.savedAt),
        0,
      ),
      items: resolvedFavoriteItems.map((item) => ({
        id: item.id,
        title: item.title,
        ...(item.programId ? { programId: item.programId } : {}),
        ...(item.programTitle ? { programTitle: item.programTitle } : {}),
        ...(item.coverUrl ? { coverUrl: item.coverUrl } : {}),
        ...(item.duration !== undefined ? { duration: item.duration } : {}),
        ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
        ...(item.isVip !== undefined ? { isVip: item.isVip } : {}),
        addedAt: item.savedAt,
      })),
    }),
    [favoriteLibrary.items, resolvedFavoriteItems],
  );
  const favoriteProgramColumns = useMemo(
    () =>
      groupFavoritesByProgram(
        resolvedFavoriteItems,
        favoriteLibrary.programOrder,
      ).map((group) => ({
        id: group.id,
        name: group.title,
        items: group.items,
      })),
    [favoriteLibrary.programOrder, resolvedFavoriteItems],
  );
  const moveFavoriteProgramByOffset = (programId: string, offset: -1 | 1) => {
    const currentIndex = favoriteProgramColumns.findIndex(
      (column) => column.id === programId,
    );
    const target = favoriteProgramColumns[currentIndex + offset];
    if (!target) return;
    moveFavoriteProgram(
      programId,
      target.id,
      offset < 0 ? "before" : "after",
    );
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (audio.paused) {
      audio.play().catch(() => setNotice("浏览器阻止了自动播放，请再试一次。"));
    } else {
      audio.pause();
    }
  };

  return (
    <main className="app-shell">
      <div className="window-titlebar" aria-hidden="true">
        <span className="window-titlebar-title">凹凸宇宙</span>
      </div>
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <div>
            <strong>凹凸宇宙</strong>
            <span>桌面收听</span>
          </div>
        </div>

        <nav className="side-nav" aria-label="主导航">
          <button
            className={
              view === "discover" &&
              !episodeDrawerOpen &&
              !programDrawerOpen
                ? "active"
                : ""
            }
            type="button"
            onClick={() => {
              setView("discover");
              clearProgramContext();
              setQuery("");
              setSearching(false);
              setSearchPrograms([]);
              setSearchEpisodes([]);
            }}
          >
            <span className="nav-glyph">首</span>
            发现节目
          </button>
          <button
            className={
              view === "history" &&
              !episodeDrawerOpen &&
              !programDrawerOpen
                ? "active"
                : ""
            }
            type="button"
            onClick={() => {
              setView("history");
              clearProgramContext();
              setQuery("");
              setSearching(false);
              setSearchPrograms([]);
              setSearchEpisodes([]);
            }}
          >
            <span className="nav-glyph">历</span>
            收听历史
          </button>
          <button
            className={
              view === "playlists" &&
              !episodeDrawerOpen &&
              !programDrawerOpen
                ? "active"
                : ""
            }
            type="button"
            onClick={() => {
              setView("playlists");
              clearProgramContext();
              setQuery("");
              setSearching(false);
              setSearchPrograms([]);
              setSearchEpisodes([]);
            }}
          >
            <span className="nav-glyph">列</span>
            播放列表
            <span className="nav-count">
              {playlistLibrary.playlists.length + 1}
            </span>
          </button>
          <button
            className={programDrawerOpen ? "active" : ""}
            type="button"
            disabled={contentLoading && discovery.programs.length === 0}
            onClick={() =>
              programDrawerOpen
                ? setProgramDrawerOpen(false)
                : openProgramDrawer()
            }
          >
            <span className="nav-glyph">栏</span>
            全部栏目
          </button>
          {(activeProgram || current?.programId) && (
            <button
              className={`episode-nav-entry ${
                episodeDrawerOpen ? "active" : ""
              }`}
              type="button"
              onClick={() =>
                episodeDrawerOpen
                  ? setEpisodeDrawerOpen(false)
                  : openEpisodeDrawer()
              }
            >
              <span className="nav-glyph">单</span>
              节目单
            </button>
          )}
        </nav>

        <div className="sidebar-spacer" />

        <UpdateNotice />

        <section className="account-panel">
          {sessionLoading ? (
            <div className="account-loading">正在检查登录状态…</div>
          ) : viewer ? (
            <>
              <div className="account-line">
                <div className="avatar">
                  {viewer.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={viewer.avatarUrl} alt="" />
                  ) : (
                    viewer.nickname.slice(0, 1)
                  )}
                </div>
                <div>
                  <strong>{viewer.nickname}</strong>
                  <span>{viewer.isVip ? "凹凸宇宙已连接" : "普通账号"}</span>
                </div>
                {viewer.isVip && <b className="vip-badge">VIP</b>}
              </div>
              <button
                className="account-logout-button"
                type="button"
                onClick={logout}
              >
                退出
              </button>
            </>
          ) : (
            <>
              <span className="account-kicker">登录</span>
              <strong>=͟͟͞͞ʕ•̫͡•ʔ=͟͟͞͞ʕ•̫͡•ʔ</strong>
              <p>使用手机号-短信验证验证码登录</p>
              <button
                className="primary-button"
                type="button"
                onClick={() => setLoginOpen(true)}
              >
                登录会员账号
              </button>
            </>
          )}
        </section>
      </aside>

      <section className="content">
        <header className="topbar">
          <label className="search-box">
            <span>搜索</span>
            <input
              type="search"
              value={query}
              placeholder="节目、单集或关键词"
              onChange={(event) => {
                const nextQuery = event.target.value;
                setQuery(nextQuery);
                if (nextQuery.trim().length < 2) {
                  setSearching(false);
                  setSearchPrograms([]);
                  setSearchEpisodes([]);
                } else {
                  setSearching(true);
                }
                setView("discover");
                clearProgramContext();
              }}
            />
            {searching && <i className="search-spinner" aria-label="搜索中" />}
          </label>
          {!viewer && (
            <button
              className="top-login"
              type="button"
              onClick={() => setLoginOpen(true)}
            >
              会员登录
            </button>
          )}
        </header>

        <div className="content-scroll">
          {view === "discover" && !query && (
            <section className="hero">
              <div className="hero-copy">
                <div className="eyebrow">
                  {viewer?.isVip ? "凹凸宇宙会员" : "公开精选"}
                </div>
                <h1>{heroProgram?.title ?? "凹凸宇宙"}</h1>
                <p>
                  {heroProgram?.description ??
                    "在电脑上连接凹凸宇宙，继续收听 App 中的节目。"}
                </p>
                <div className="hero-actions">
                  {displayEpisodes[0] && (
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => beginPlayback(displayEpisodes[0])}
                    >
                      播放最新一期
                    </button>
                  )}
                  {!viewer && (
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setLoginOpen(true)}
                    >
                      连接会员
                    </button>
                  )}
                </div>
              </div>
              <div className="hero-art" aria-hidden="true">
                <div className="orbit orbit-one" />
                <div className="orbit orbit-two" />
                <HeroArtwork program={heroProgram} />
                <div className="sound-bars">
                  {Array.from({ length: 13 }).map((_, index) => (
                    <i key={index} style={{ "--bar": index } as React.CSSProperties} />
                  ))}
                </div>
              </div>
            </section>
          )}

          {view === "discover" && displayPrograms.length > 0 && !activeProgram && (
            <section className="program-strip" aria-labelledby="program-heading">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">栏目宇宙</span>
                  <h2 id="program-heading">
                    {query ? "相关栏目" : "精选栏目"}
                  </h2>
                </div>
                {query ? (
                  <span>{displayPrograms.length} 个栏目</span>
                ) : (
                  <button
                    className="catalog-open-button"
                    type="button"
                    onClick={openProgramDrawer}
                  >
                    查看全部 {displayPrograms.length} 个栏目
                  </button>
                )}
              </div>
              <div className="program-grid">
                {featuredPrograms.map((program, index) => (
                  <button
                    className="program-card"
                    type="button"
                    key={program.id}
                    onClick={() => selectProgram(program)}
                    style={{ "--index": index } as React.CSSProperties}
                  >
                    <Cover
                      className="program-cover"
                      src={program.coverUrl}
                      title={program.title}
                    />
                    <span className="program-overlay">
                      <strong>{program.title}</strong>
                      <small>
                        {program.episodeCount
                          ? `${program.episodeCount} 期`
                          : "查看节目"}
                      </small>
                    </span>
                    {program.isVip && <b className="card-vip">VIP</b>}
                  </button>
                ))}
              </div>
            </section>
          )}

          {view === "playlists" && (
            <PlaylistWorkspace
              library={playlistLibrary}
              specialPlaylistId={SPECIAL_FAVORITES_PLAYLIST_ID}
              specialPlaylistCount={favoriteLibrary.items.length}
              specialContent={
                <SpecialFavoritesPlaylist
                  playlist={specialFavoritesPlaylist}
                  columns={favoriteProgramColumns}
                  activeFilter={favoriteCategoryFilter}
                  currentEpisodeId={current?.id}
                  busyEpisodeId={playerBusyId}
                  activeQueue={
                    activeQueue?.playlistId ===
                    SPECIAL_FAVORITES_PLAYLIST_ID
                  }
                  exporting={
                    playlistExportingId ===
                    SPECIAL_FAVORITES_PLAYLIST_ID
                  }
                  onFilterChange={setFavoriteCategoryFilter}
                  onPlay={(episode) => beginPlayback(episode)}
                  onPlayAll={() =>
                    playCustomPlaylist(specialFavoritesPlaylist)
                  }
                  onAddToPlaylist={setPlaylistPickerEpisode}
                  onToggleFavorite={toggleSpecialFavorite}
                  onExport={() =>
                    void exportCustomPlaylist(specialFavoritesPlaylist)
                  }
                  onMoveProgram={moveFavoriteProgram}
                  onMoveProgramByOffset={moveFavoriteProgramByOffset}
                />
              }
              favoriteIds={favoriteIds}
              selectedPlaylistId={selectedPlaylistId}
              currentEpisodeId={current?.id}
              busyEpisodeId={playerBusyId}
              activeQueuePlaylistId={activeQueue?.playlistId ?? ""}
              importing={playlistImporting}
              exportingPlaylistId={playlistExportingId}
              onSelect={setSelectedPlaylistId}
              onCreate={(name) => createNewPlaylist(name)}
              onRename={renameCustomPlaylist}
              onDelete={removeCustomPlaylist}
              onPlay={(episode) => beginPlayback(episode)}
              onPlayAll={playCustomPlaylist}
              onRemove={removePlaylistEpisode}
              onOpenPicker={setPlaylistPickerEpisode}
              onToggleFavorite={toggleSpecialFavorite}
              onExport={(playlist) => void exportCustomPlaylist(playlist)}
              onImport={(file) => void importCustomPlaylist(file)}
            />
          )}

          {view !== "playlists" && (
          <section className="episodes" aria-labelledby="episode-heading">
            <div className="section-heading">
              <div>
                <span className="eyebrow">
                  {view === "history"
                    ? "仅保存在这台电脑"
                    : activeProgram
                      ? "节目列表"
                      : query
                        ? "搜索结果"
                        : "最近更新"}
                </span>
                <h2 id="episode-heading">{pageTitle}</h2>
              </div>
              {activeProgram && (
                <div className="section-heading-actions">
                  <button
                    className="secondary-button episode-drawer-trigger"
                    type="button"
                    onClick={openEpisodeDrawer}
                  >
                    节目单 · {programTotal || programEpisodes.length} 期
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    onClick={clearProgramContext}
                  >
                    返回全部栏目
                  </button>
                </div>
              )}
            </div>

            {contentLoading || programLoading || searching ? (
              <LoadingRows />
            ) : programError || (contentError && !activeProgram) ? (
              <div className="state-panel error-state">
                <strong>节目暂时没有载入</strong>
                <p>{programError || contentError}</p>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() =>
                    activeProgram
                      ? void selectProgram(activeProgram)
                      : void loadDiscovery()
                  }
                >
                  重新连接
                </button>
              </div>
            ) : displayEpisodes.length === 0 ? (
              <div className="state-panel">
                <strong>
                  {view === "history"
                    ? "还没有收听记录"
                    : "没有找到相关节目"}
                </strong>
                <p>
                  {view === "history"
                    ? "播放任意一期后，会在这里保留进度。"
                    : "换一个关键词，或登录凹凸宇宙会员查看完整节目库。"}
                </p>
              </div>
            ) : (
              <div className="episode-list">
                {displayEpisodes.map((episode, index) => (
                  <article
                    className={`episode-row ${
                      current?.id === episode.id ? "current" : ""
                    }`}
                    key={episode.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`播放 ${episode.title}`}
                    style={{ "--index": index } as React.CSSProperties}
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest("button")) return;
                      void beginPlayback(episode);
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.target === event.currentTarget &&
                        ["Enter", " "].includes(event.key)
                      ) {
                        event.preventDefault();
                        void beginPlayback(episode);
                      }
                    }}
                  >
                    <Cover
                      className="episode-cover"
                      src={episode.coverUrl}
                      title={episode.title}
                    />
                    <div className="episode-copy">
                      <div className="episode-meta">
                        <span>{episode.programTitle ?? "凹凸宇宙"}</span>
                        <span>{formatDate(episode.publishedAt)}</span>
                        {episode.isVip && <b>VIP</b>}
                      </div>
                      <h3>{episode.title}</h3>
                      {episode.description && <p>{episode.description}</p>}
                    </div>
                    <span className="episode-duration">
                      {formatDuration(episode.duration)}
                    </span>
                    <div className="episode-actions">
                      <button
                        className="playlist-button"
                        type="button"
                        aria-label={`将 ${episode.title} 加入播放列表`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setPlaylistPickerEpisode(episode);
                        }}
                      >
                        加列表
                      </button>
                      <HeartButton
                        saved={favoriteIds.has(episode.id)}
                        label={episode.title}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleSpecialFavorite(episode);
                        }}
                      />
                      <button
                        className="round-play"
                        type="button"
                        aria-label={`播放 ${episode.title}`}
                        disabled={playerBusyId === episode.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          void beginPlayback(episode);
                        }}
                      >
                        {playerBusyId === episode.id
                          ? "…"
                          : current?.id === episode.id && isPlaying
                            ? "暂停"
                            : "播放"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
          )}
        </div>
      </section>

      <footer className={`player-dock ${current ? "ready" : ""}`}>
        <audio
          ref={audioRef}
          src={current?.audioUrl}
          preload="metadata"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onLoadedMetadata={(event) => {
            const media = event.currentTarget;
            setDuration(media.duration);
            media.volume = volume;
            media.playbackRate = speed;
            const saved = history.find((item) => item.id === current?.id);
            if (saved && saved.position < media.duration - 20) {
              media.currentTime = saved.position;
              setCurrentTime(saved.position);
              lastSavedRef.current = saved.position;
            }
          }}
          onCanPlay={(event) => {
            if (
              autoplayEpisodeIdRef.current !== current?.id ||
              autoplayInFlightRef.current
            ) {
              return;
            }
            autoplayInFlightRef.current = true;
            void event.currentTarget
              .play()
              .then(() => {
                if (autoplayEpisodeIdRef.current === current?.id) {
                  autoplayEpisodeIdRef.current = "";
                }
              })
              .catch(() => {
                autoplayEpisodeIdRef.current = "";
                setNotice("自动播放未能启动，请点击底部播放键继续。");
              })
              .finally(() => {
                autoplayInFlightRef.current = false;
              });
          }}
          onTimeUpdate={(event) => {
            const media = event.currentTarget;
            setCurrentTime(media.currentTime);
            if (
              current &&
              media.currentTime - lastSavedRef.current >= PROGRESS_INTERVAL
            ) {
              lastSavedRef.current = media.currentTime;
              persistHistory(current, media.currentTime, media.duration);
            }
          }}
          onEnded={() => {
            setIsPlaying(false);
            playNextInQueue();
          }}
          onError={() => setNotice("音频加载失败，请重新选择这期节目。")}
        />
        <div className="now-playing">
          {current ? (
            <>
              <Cover
                className="dock-cover"
                src={current.coverUrl}
                title={current.title}
              />
              <div>
                <strong>{current.title}</strong>
                {current.programId ? (
                  <button
                    className="dock-program-link"
                    type="button"
                    onClick={openEpisodeDrawer}
                  >
                    {current.programTitle ?? "凹凸宇宙"} · 本栏节目单
                  </button>
                ) : (
                  <span>{current.programTitle ?? "凹凸宇宙"}</span>
                )}
              </div>
            </>
          ) : (
            <div className="player-placeholder">
              <strong>选择一期节目开始播放</strong>
              <span>播放进度会保存在这台电脑</span>
            </div>
          )}
        </div>
        <div className="transport">
          <div className="transport-buttons">
            <button
              type="button"
              disabled={!current}
              onClick={() => {
                if (audioRef.current) {
                  audioRef.current.currentTime = Math.max(
                    0,
                    audioRef.current.currentTime - 15,
                  );
                }
              }}
            >
              后退 15 秒
            </button>
            <button
              className="main-play"
              type="button"
              disabled={!current}
              onClick={togglePlay}
            >
              {isPlaying ? "暂停" : "播放"}
            </button>
            <button
              type="button"
              disabled={!current}
              onClick={() => {
                if (audioRef.current) {
                  audioRef.current.currentTime = Math.min(
                    audioRef.current.duration || 0,
                    audioRef.current.currentTime + 30,
                  );
                }
              }}
            >
              前进 30 秒
            </button>
          </div>
          <div className="timeline">
            <span>{formatDuration(currentTime)}</span>
            <input
              aria-label="播放进度"
              type="range"
              min={0}
              max={duration || 0}
              step={1}
              value={Math.min(currentTime, duration || 0)}
              disabled={!current}
              onChange={(event) => {
                const next = Number(event.target.value);
                setCurrentTime(next);
                if (audioRef.current) audioRef.current.currentTime = next;
              }}
              style={
                {
                  "--progress": `${
                    duration ? Math.min(100, (currentTime / duration) * 100) : 0
                  }%`,
                } as React.CSSProperties
              }
            />
            <span>{formatDuration(duration)}</span>
          </div>
        </div>
        <div className="player-options">
          <label>
            <span>速度</span>
            <select
              value={speed}
              disabled={!current}
              onChange={(event) => {
                const next = Number(event.target.value);
                setSpeed(next);
                if (audioRef.current) audioRef.current.playbackRate = next;
              }}
            >
              {[0.75, 1, 1.25, 1.5, 2].map((value) => (
                <option value={value} key={value}>
                  {value}×
                </option>
              ))}
            </select>
          </label>
          <label className="volume-control">
            <span>音量</span>
            <input
              aria-label="音量"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(event) => {
                const next = Number(event.target.value);
                setVolume(next);
                if (audioRef.current) audioRef.current.volume = next;
              }}
            />
          </label>
        </div>
      </footer>

      {programDrawerOpen && (
        <ProgramDrawer
          programs={discovery.programs}
          activeProgramId={activeProgram?.id ?? current?.programId}
          pinnedIds={programPreferences.pinnedIds}
          sort={programPreferences.sort}
          loading={contentLoading}
          error={contentError}
          onClose={() => setProgramDrawerOpen(false)}
          onSelect={selectProgram}
          onTogglePin={toggleProgramPin}
          onSortChange={changeProgramSort}
          onRetry={() => void loadDiscovery()}
        />
      )}

      {episodeDrawerOpen && activeProgram && (
        <EpisodeDrawer
          key={activeProgram.id}
          program={activeProgram}
          episodes={programEpisodes}
          history={history}
          currentId={current?.id}
          isPlaying={isPlaying}
          busyEpisodeId={playerBusyId}
          favoriteIds={favoriteIds}
          loading={programLoading}
          loadingMore={programLoadingMore}
          total={
            programTotal ?? activeProgram.episodeCount ?? programEpisodes.length
          }
          hasMore={programHasMore}
          error={programError}
          onClose={() => setEpisodeDrawerOpen(false)}
          onPlay={beginPlayback}
          onRetry={() => void selectProgram(activeProgram)}
          onLoadMore={() => void loadMoreProgramEpisodes()}
          onToggleFavorite={toggleSpecialFavorite}
          onAddToPlaylist={setPlaylistPickerEpisode}
        />
      )}

      {notice && (
        <div className="toast" role="status" aria-live="polite">
          {notice}
        </div>
      )}

      {playlistPickerEpisode && (
        <PlaylistPicker
          episode={playlistPickerEpisode}
          playlists={playlistLibrary.playlists}
          onClose={() => setPlaylistPickerEpisode(null)}
          onCreate={(name) =>
            createNewPlaylist(name, playlistPickerEpisode)
          }
          onToggle={(playlistId, selected) =>
            toggleEpisodePlaylist(
              playlistId,
              playlistPickerEpisode,
              selected,
            )
          }
        />
      )}

      {loginOpen && (
        <LoginDialog
          busy={loginBusy}
          message={loginMessage}
          cooldown={cooldown}
          onClose={() => setLoginOpen(false)}
          onSendCode={sendCode}
          onLogin={login}
        />
      )}
    </main>
  );
}
