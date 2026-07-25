"use client";

import { useEffect, useMemo, useState } from "react";
import type { Episode, HistoryEntry, Program } from "./types";

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
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function EpisodeDrawer({
  program,
  episodes,
  history,
  currentId,
  isPlaying,
  busyEpisodeId,
  loading,
  loadingMore,
  total,
  hasMore,
  error,
  onClose,
  onPlay,
  onRetry,
  onLoadMore,
}: {
  program: Program;
  episodes: Episode[];
  history: HistoryEntry[];
  currentId?: string;
  isPlaying: boolean;
  busyEpisodeId: string;
  loading: boolean;
  loadingMore: boolean;
  total: number;
  hasMore: boolean;
  error: string;
  onClose: () => void;
  onPlay: (episode: Episode) => void | Promise<void>;
  onRetry: () => void;
  onLoadMore: () => void;
}) {
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const historyById = useMemo(
    () => new Map(history.map((entry) => [entry.id, entry])),
    [history],
  );
  const normalizedFilter = filter.trim().toLocaleLowerCase("zh-CN");
  const visibleEpisodes = useMemo(
    () =>
      episodes
        .map((episode, index) => ({ episode, order: index + 1 }))
        .filter(({ episode }) => {
          if (!normalizedFilter) return true;
          return [episode.title, episode.description, episode.publishedAt]
            .filter(Boolean)
            .some((value) =>
              String(value).toLocaleLowerCase("zh-CN").includes(normalizedFilter),
            );
        }),
    [episodes, normalizedFilter],
  );
  const knownTotal = total || program.episodeCount || episodes.length;

  return (
    <div className="episode-drawer-layer">
      <button
        className="episode-drawer-scrim"
        type="button"
        tabIndex={-1}
        aria-label="关闭本栏节目单"
        onClick={onClose}
      />
      <aside
        className="episode-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="episode-drawer-title"
      >
        <header className="episode-drawer-header">
          <div>
            <span className="eyebrow">
              本栏节目单 · 已载入 {episodes.length}
              {knownTotal > episodes.length ? ` / ${knownTotal}` : ""} 期
            </span>
            <h2 id="episode-drawer-title">{program.title}</h2>
          </div>
          <button className="drawer-close" type="button" onClick={onClose}>
            关闭
          </button>
        </header>

        <label className="drawer-search">
          <span>在本节目中筛选</span>
          <input
            type="search"
            value={filter}
            placeholder="输入标题或关键词"
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>

        <div
          className="episode-drawer-content"
          aria-live="polite"
          aria-busy={loading}
        >
          {loading ? (
            <div className="drawer-loading" aria-label="正在载入本栏节目单">
              {[0, 1, 2, 3, 4].map((item) => (
                <div className="drawer-skeleton" key={item}>
                  <span />
                  <div>
                    <i />
                    <i />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="drawer-state drawer-error">
              <strong>节目单暂时没有载入</strong>
              <p>{error}</p>
              <button type="button" onClick={onRetry}>
                重新载入
              </button>
            </div>
          ) : visibleEpisodes.length === 0 ? (
            <div className="drawer-state">
              <strong>{filter ? "没有匹配的节目" : "暂时没有节目"}</strong>
              <p>
                {filter
                  ? "换一个关键词继续筛选。"
                  : "该栏目还没有可展示的节目。"}
              </p>
            </div>
          ) : (
            <ol className="drawer-episode-list">
              {visibleEpisodes.map(({ episode, order }) => {
                const saved = historyById.get(episode.id);
                const progress =
                  saved?.duration && saved.position
                    ? Math.min(100, (saved.position / saved.duration) * 100)
                    : 0;
                const isCurrent = currentId === episode.id;

                return (
                  <li key={episode.id}>
                    <button
                      className={`drawer-episode ${isCurrent ? "current" : ""}`}
                      type="button"
                      aria-current={isCurrent ? "true" : undefined}
                      disabled={busyEpisodeId === episode.id}
                      onClick={() => onPlay(episode)}
                    >
                      <span className="drawer-episode-index">
                        {String(order).padStart(2, "0")}
                      </span>
                      <span className="drawer-episode-copy">
                        <span className="drawer-episode-meta">
                          <span>{formatDate(episode.publishedAt)}</span>
                          <span>{formatDuration(episode.duration)}</span>
                          {episode.isVip && <b>VIP</b>}
                        </span>
                        <strong>{episode.title}</strong>
                        {saved && saved.position > 5 && (
                          <span className="drawer-resume">
                            上次听到 {formatDuration(saved.position)}
                          </span>
                        )}
                        {progress > 0 && (
                          <span className="drawer-progress" aria-hidden="true">
                            <i style={{ transform: `scaleX(${progress / 100})` }} />
                          </span>
                        )}
                      </span>
                      <span className="drawer-episode-action">
                        {busyEpisodeId === episode.id
                          ? "载入中"
                          : isCurrent && isPlaying
                            ? "暂停"
                            : saved && saved.position > 5
                              ? "续播"
                              : "播放"}
                      </span>
                    </button>
                  </li>
                );
              })}
              {!filter && hasMore && (
                <li className="drawer-load-more">
                  <button
                    type="button"
                    disabled={loadingMore}
                    onClick={onLoadMore}
                  >
                    {loadingMore
                      ? "正在载入更多节目…"
                      : `继续载入剩余节目（${episodes.length} / ${knownTotal}）`}
                  </button>
                </li>
              )}
              {!filter && !hasMore && episodes.length > 0 && (
                <li className="drawer-list-end">
                  已显示全部 {episodes.length} 期
                </li>
              )}
            </ol>
          )}
        </div>
      </aside>
    </div>
  );
}
