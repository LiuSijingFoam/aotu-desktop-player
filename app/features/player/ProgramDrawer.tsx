"use client";

import { useEffect, useMemo, useState } from "react";
import { sortPrograms, type ProgramSort } from "./program-preferences";
import type { Program } from "./types";

function latestEpisodeLabel(unixSeconds?: number) {
  if (
    typeof unixSeconds !== "number" ||
    !Number.isFinite(unixSeconds) ||
    unixSeconds <= 0
  ) {
    return "更新时间未知";
  }

  const date = new Date(unixSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "更新时间未知";
  const includeYear = date.getFullYear() !== new Date().getFullYear();
  return `更新于 ${new Intl.DateTimeFormat("zh-CN", {
    year: includeYear ? "numeric" : undefined,
    month: "short",
    day: "numeric",
  }).format(date)}`;
}

function ProgramThumb({
  program,
}: {
  program: Program;
}) {
  const [failed, setFailed] = useState(false);
  if (!program.coverUrl || failed) {
    return (
      <span className="program-drawer-fallback" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    );
  }
  return (
    // Catalog art is proxied through this application's allowlisted image route.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="program-drawer-cover"
      src={program.coverUrl}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function ProgramDrawer({
  programs,
  activeProgramId,
  pinnedIds,
  sort,
  loading,
  error,
  onClose,
  onSelect,
  onTogglePin,
  onSortChange,
  onRetry,
}: {
  programs: Program[];
  activeProgramId?: string;
  pinnedIds: string[];
  sort: ProgramSort;
  loading: boolean;
  error: string;
  onClose: () => void;
  onSelect: (program: Program) => void | Promise<void>;
  onTogglePin: (programId: string) => void;
  onSortChange: (sort: ProgramSort) => void;
  onRetry: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [pinAnnouncement, setPinAnnouncement] = useState("");

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    if (!pinAnnouncement) return;
    const timer = window.setTimeout(() => setPinAnnouncement(""), 2200);
    return () => window.clearTimeout(timer);
  }, [pinAnnouncement]);

  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);
  const normalizedFilter = filter.trim().toLocaleLowerCase("zh-CN");
  const visiblePrograms = useMemo(
    () => {
      const filtered = programs.filter((program) => {
        if (!normalizedFilter) return true;
        return [program.title, program.description]
          .filter(Boolean)
          .some((value) =>
              String(value).toLocaleLowerCase("zh-CN").includes(normalizedFilter),
            );
      });
      return sortPrograms(filtered, pinnedIds, sort);
    },
    [normalizedFilter, pinnedIds, programs, sort],
  );
  const pinnedCount = programs.filter((program) =>
    pinnedSet.has(program.id),
  ).length;

  return (
    <div className="episode-drawer-layer program-drawer-layer">
      <button
        className="episode-drawer-scrim"
        type="button"
        tabIndex={-1}
        aria-label="关闭全部栏目侧边栏"
        onClick={onClose}
      />
      <aside
        className="episode-drawer program-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="program-drawer-title"
      >
        <header className="episode-drawer-header">
          <div>
            <span className="eyebrow">
              全部栏目 · {programs.length} 个
              {pinnedCount > 0 ? ` · 已置顶 ${pinnedCount}` : ""}
            </span>
            <h2 id="program-drawer-title">选择想听的栏目</h2>
          </div>
          <button className="drawer-close" type="button" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="program-drawer-tools">
          <label className="drawer-search">
            <span>筛选栏目</span>
            <input
              type="search"
              autoFocus
              value={filter}
              placeholder="输入栏目名称或关键词"
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
          <label className="program-sort-control">
            <span>排列方式</span>
            <select
              value={sort}
              onChange={(event) =>
                onSortChange(event.target.value as ProgramSort)
              }
            >
              <option value="platform">平台顺序</option>
              <option value="latest-desc">最近更新</option>
              <option value="latest-asc">最久未更新</option>
              <option value="name">栏目名称</option>
              <option value="episode-count">节目数量</option>
            </select>
          </label>
        </div>
        <p className="sr-only" aria-live="polite">
          {pinAnnouncement}
        </p>

        <div
          className="episode-drawer-content"
          aria-busy={loading}
        >
          {loading ? (
            <div className="drawer-loading" aria-label="正在载入全部栏目">
              {[0, 1, 2, 3, 4].map((item) => (
                <div className="drawer-skeleton program-drawer-skeleton" key={item}>
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
              <strong>栏目暂时没有载入</strong>
              <p>{error}</p>
              <button type="button" onClick={onRetry}>
                重新载入
              </button>
            </div>
          ) : visiblePrograms.length === 0 ? (
            <div className="drawer-state">
              <strong>{filter ? "没有匹配的栏目" : "暂时没有栏目"}</strong>
              <p>
                {filter
                  ? "换一个关键词继续筛选。"
                  : "登录会员账号后可读取完整栏目库。"}
              </p>
            </div>
          ) : (
            <ul className="program-drawer-list">
              {visiblePrograms.map((program) => {
                const isCurrent = activeProgramId === program.id;
                const isPinned = pinnedSet.has(program.id);
                return (
                  <li
                    className={`program-drawer-row ${
                      isPinned ? "pinned" : ""
                    }`}
                    key={program.id}
                  >
                    <button
                      className={`program-drawer-item ${
                        isCurrent ? "current" : ""
                      }`}
                      type="button"
                      aria-current={isCurrent ? "true" : undefined}
                      onClick={() => onSelect(program)}
                    >
                      <ProgramThumb program={program} />
                      <span className="program-drawer-copy">
                        <strong>{program.title}</strong>
                        <span>
                          {program.episodeCount
                            ? `${program.episodeCount} 期`
                            : "期数未知"}
                          {" · "}
                          {latestEpisodeLabel(program.latestEpisodeAt)}
                        </span>
                      </span>
                      <span className="program-drawer-action">
                        {program.isVip && <b>VIP</b>}
                        <span>{isCurrent ? "当前" : "查看"}</span>
                      </span>
                    </button>
                    <button
                      className="program-pin-button"
                      type="button"
                      aria-label={`${isPinned ? "取消置顶" : "置顶"}《${
                        program.title
                      }》`}
                      aria-pressed={isPinned}
                      title={isPinned ? "取消置顶" : "置顶栏目"}
                      onClick={() => {
                        onTogglePin(program.id);
                        setPinAnnouncement(
                          `${isPinned ? "已取消置顶" : "已置顶"}《${
                            program.title
                          }》`,
                        );
                      }}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path d="M9 3h6l-1.1 5.2 3.1 3.1V13h-4v7l-1 1-1-1v-7H7v-1.7l3.1-3.1L9 3Z" />
                      </svg>
                    </button>
                  </li>
                );
              })}
              <li className="drawer-list-end">
                已显示全部 {visiblePrograms.length} 个栏目
              </li>
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
