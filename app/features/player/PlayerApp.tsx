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
import type {
  DiscoveryPayload,
  Episode,
  HistoryEntry,
  Program,
  Viewer,
} from "./types";

const HISTORY_KEY = "aotu-desktop-history-v1";
const PROGRESS_INTERVAL = 5;

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
  if (error instanceof TypeError) return "暂时无法连接服务，请检查公司网络后重试。";
  return "发生了意外错误，请稍后再试。";
}

function readHistory(): HistoryEntry[] {
  try {
    const value = localStorage.getItem(HISTORY_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value) as HistoryEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, 40) : [];
  } catch {
    return [];
  }
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
      setFormError("请输入 11 位中国大陆手机号。");
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
          验证码由凹凸宇宙官方服务发送。本站不会保存手机号、验证码或明文会员令牌。
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
          仅调用官方登录和会员校验，不提供下载或会员权限绕过。
        </p>
      </section>
    </div>
  );
}

export function PlayerApp() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastSavedRef = useRef(0);
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
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchPrograms, setSearchPrograms] = useState<Program[]>([]);
  const [searchEpisodes, setSearchEpisodes] = useState<Episode[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [view, setView] = useState<"discover" | "history">("discover");
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
    queueMicrotask(() => setHistory(readHistory()));
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
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
        return next;
      });
    },
    [],
  );

  const beginPlayback = useCallback(
    async (episode: Episode) => {
      const audio = audioRef.current;
      if (current?.id === episode.id && audio) {
        if (audio.paused) {
          await audio.play().catch(() => setNotice("点击播放器中的播放键继续。"));
        } else {
          audio.pause();
        }
        return;
      }

      setPlayerBusyId(episode.id);
      try {
        const resolved = episode.audioUrl
          ? episode
          : (await playerApi.episode(episode.id)).episode;
        if (!resolved.audioUrl) {
          throw new ApiError(409, "AUDIO_UNAVAILABLE", "该节目的音频地址暂不可用。");
        }

        setCurrent(resolved);
        setCurrentTime(0);
        setDuration(resolved.duration ?? 0);
        window.setTimeout(() => {
          const player = audioRef.current;
          if (!player) return;
          player
            .play()
            .catch(() => setNotice("音频已就绪，请点击底部播放键开始。"));
        }, 0);
      } catch (error) {
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

  const selectProgram = async (program: Program) => {
    setView("discover");
    setQuery("");
    setSearching(false);
    setSearchPrograms([]);
    setSearchEpisodes([]);
    setActiveProgram(program);
    setProgramLoading(true);
    setProgramEpisodes([]);
    try {
      const result = await playerApi.program(program.id);
      setActiveProgram(result.program);
      setProgramEpisodes(result.episodes);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setProgramLoading(false);
    }
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
      setActiveProgram(null);
      setProgramEpisodes([]);
      setNotice("已安全退出。");
      await loadDiscovery();
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };

  const displayPrograms = query.trim().length >= 2
    ? searchPrograms
    : discovery.programs;
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
      : query.trim().length >= 2
        ? `搜索“${query.trim()}”`
        : activeProgram?.title ?? "今天，听点有意思的";

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
            className={view === "discover" ? "active" : ""}
            type="button"
            onClick={() => {
              setView("discover");
              setActiveProgram(null);
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
            className={view === "history" ? "active" : ""}
            type="button"
            onClick={() => {
              setView("history");
              setActiveProgram(null);
              setQuery("");
              setSearching(false);
              setSearchPrograms([]);
              setSearchEpisodes([]);
            }}
          >
            <span className="nav-glyph">历</span>
            收听历史
          </button>
        </nav>

        <div className="sidebar-spacer" />

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
                  <span>{viewer.isVip ? "会员已连接" : "普通账号"}</span>
                </div>
                {viewer.isVip && <b className="vip-badge">VIP</b>}
              </div>
              <button className="text-button" type="button" onClick={logout}>
                安全退出
              </button>
            </>
          ) : (
            <>
              <span className="account-kicker">你的会员内容</span>
              <strong>登录后读取完整节目库</strong>
              <p>官方短信验证，令牌仅保存在安全会话中。</p>
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
                setActiveProgram(null);
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
                  {viewer?.isVip ? "会员专属宇宙" : "公开精选"}
                </div>
                <h1>{heroProgram?.title ?? "让耳朵先出发"}</h1>
                <p>
                  {heroProgram?.description ??
                    "在电脑上连接你的凹凸宇宙会员账号，继续收听 App 中的节目。"}
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
                <div className="hero-disc">
                  <span />
                </div>
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
                  <span className="eyebrow">节目宇宙</span>
                  <h2 id="program-heading">
                    {query ? "相关节目" : "选择一个频道"}
                  </h2>
                </div>
                <span>{displayPrograms.length} 个节目</span>
              </div>
              <div className="program-grid">
                {displayPrograms.map((program, index) => (
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
                <button
                  className="text-button"
                  type="button"
                  onClick={() => {
                    setActiveProgram(null);
                    setProgramEpisodes([]);
                  }}
                >
                  返回全部节目
                </button>
              )}
            </div>

            {contentLoading || programLoading || searching ? (
              <LoadingRows />
            ) : contentError ? (
              <div className="state-panel error-state">
                <strong>节目暂时没有载入</strong>
                <p>{contentError}</p>
                <button className="secondary-button" type="button" onClick={loadDiscovery}>
                  重新连接
                </button>
              </div>
            ) : displayEpisodes.length === 0 ? (
              <div className="state-panel">
                <strong>
                  {view === "history" ? "还没有收听记录" : "没有找到相关节目"}
                </strong>
                <p>
                  {view === "history"
                    ? "播放任意一期后，会在这里保留进度。"
                    : "换一个关键词，或登录会员账号查看完整节目库。"}
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
                    style={{ "--index": index } as React.CSSProperties}
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
                    <button
                      className="round-play"
                      type="button"
                      aria-label={`播放 ${episode.title}`}
                      disabled={playerBusyId === episode.id}
                      onClick={() => beginPlayback(episode)}
                    >
                      {playerBusyId === episode.id
                        ? "…"
                        : current?.id === episode.id && isPlaying
                          ? "暂停"
                          : "播放"}
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
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
            }
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
          onEnded={() => setIsPlaying(false)}
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
                <span>{current.programTitle ?? "凹凸宇宙"}</span>
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

      {notice && (
        <div className="toast" role="status" aria-live="polite">
          {notice}
        </div>
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
