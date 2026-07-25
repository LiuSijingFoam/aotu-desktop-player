"use client";

import { useEffect, useMemo, useState } from "react";
import { filterEpisodesByQuery } from "./episode-search";
import type { FavoriteEpisode } from "./favorites";
import { HeartButton } from "./HeartButton";
import type { CustomPlaylist } from "./playlists";
import type { Episode } from "./types";

type FavoriteProgramColumn = {
  id: string;
  name: string;
  items: FavoriteEpisode[];
};

function FavoriteCover({
  episode,
}: {
  episode: FavoriteEpisode;
}) {
  const [failed, setFailed] = useState(false);
  if (!episode.coverUrl || failed) {
    return (
      <span className="favorite-mini-cover cover-fallback" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    );
  }
  return (
    // Favorite artwork is a catalog image already proxied by the application.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="favorite-mini-cover"
      src={episode.coverUrl}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function SpecialFavoritesPlaylist({
  playlist,
  searchQuery,
  columns,
  activeFilter,
  currentEpisodeId,
  busyEpisodeId,
  activeQueue,
  exporting,
  onFilterChange,
  onPlay,
  onPlayAll,
  onAddToPlaylist,
  onToggleFavorite,
  onExport,
  onMoveProgram,
  onMoveProgramByOffset,
}: {
  playlist: CustomPlaylist;
  searchQuery: string;
  columns: FavoriteProgramColumn[];
  activeFilter: string;
  currentEpisodeId?: string;
  busyEpisodeId: string;
  activeQueue: boolean;
  exporting: boolean;
  onFilterChange: (filter: string) => void;
  onPlay: (episode: Episode) => void | Promise<void>;
  onPlayAll: () => void;
  onAddToPlaylist: (episode: Episode) => void;
  onToggleFavorite: (episode: Episode) => void;
  onExport: () => void;
  onMoveProgram: (
    sourceId: string,
    targetId: string,
    position: "before" | "after",
  ) => void;
  onMoveProgramByOffset: (programId: string, offset: -1 | 1) => void;
}) {
  const [draggedProgramId, setDraggedProgramId] = useState("");
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    position: "before" | "after";
  } | null>(null);
  const normalizedSearchQuery = searchQuery.trim();
  const matchedItems = useMemo(
    () => filterEpisodesByQuery(playlist.items, searchQuery),
    [playlist.items, searchQuery],
  );
  const filteredColumns = useMemo(
    () =>
      columns
        .map((column) => ({
          ...column,
          items: filterEpisodesByQuery(column.items, searchQuery),
        }))
        .filter((column) => column.items.length > 0),
    [columns, searchQuery],
  );
  const visibleColumns = activeFilter.startsWith("program:")
    ? filteredColumns.filter(
        (column) =>
          column.id === activeFilter.slice("program:".length),
      )
    : filteredColumns;

  useEffect(() => {
    if (
      activeFilter.startsWith("program:") &&
      !columns.some(
        (column) =>
          column.id === activeFilter.slice("program:".length),
      )
    ) {
      onFilterChange("all");
    }
  }, [activeFilter, columns, onFilterChange]);

  return (
    <section
      className="special-favorites-playlist"
      aria-labelledby="special-favorites-title"
    >
      <header className="playlist-detail-header special-favorites-header">
        <div>
          <span className="eyebrow">
            内置列表 ·{" "}
            {normalizedSearchQuery
              ? `${matchedItems.length}/${playlist.items.length} 期 · 当前列表搜索`
              : `${playlist.items.length} 期节目`}
            {activeQueue ? " · 当前播放队列" : ""}
          </span>
          <h3 id="special-favorites-title">特别收藏</h3>
        </div>
        <div className="playlist-detail-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={matchedItems.length === 0}
            onClick={onPlayAll}
          >
            播放全部
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={exporting}
            onClick={onExport}
          >
            {exporting ? "生成图片中…" : "导出图片"}
          </button>
        </div>
      </header>

      {playlist.items.length === 0 ? (
        <div className="playlist-detail-empty compact">
          <span className="playlist-empty-heart" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M12 20.4 4.2 13A5.3 5.3 0 0 1 12 5.8 5.3 5.3 0 0 1 19.8 13L12 20.4Z" />
            </svg>
          </span>
          <strong>还没有特别收藏</strong>
          <p>点击任意节目旁的红心，节目会按原始栏目自动归入这里。</p>
        </div>
      ) : (
        <>
          <section
            className="favorite-toolbar favorite-special-toolbar"
            aria-label="特别收藏栏目筛选"
          >
            <div className="favorite-filter-group">
              <span>原始栏目</span>
              <div className="favorite-filter-strip">
                <button
                  className={activeFilter === "all" ? "active" : ""}
                  type="button"
                  onClick={() => onFilterChange("all")}
                >
                  全部 {playlist.items.length}
                </button>
                {columns.map((column) => (
                  <button
                    className={
                      activeFilter === `program:${column.id}` ? "active" : ""
                    }
                    type="button"
                    key={column.id}
                    onClick={() =>
                      onFilterChange(`program:${column.id}`)
                    }
                  >
                    {column.name} {column.items.length}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section
            className="favorite-board special-favorites-board"
            aria-labelledby="favorite-board-title"
          >
            <div className="section-heading">
              <div>
                <span className="eyebrow">来自原始栏目</span>
                <h4 id="favorite-board-title">按栏目归类</h4>
              </div>
              <span>{visibleColumns.length} 个栏目</span>
            </div>
            <div className="favorite-columns favorite-program-sections">
              {visibleColumns.length === 0 ? (
                <div className="playlist-detail-empty compact">
                  <strong>特别收藏中没有匹配节目</strong>
                  <p>试试节目名、栏目名或其他关键词。</p>
                </div>
              ) : (
                visibleColumns.map((column) => (
                  <section
                    className={`favorite-column ${
                      draggedProgramId === column.id ? "dragging" : ""
                    } ${
                      dropTarget?.id === column.id
                        ? `drop-${dropTarget.position}`
                        : ""
                    }`}
                    key={column.id}
                    onDragOver={(event) => {
                      if (
                        !draggedProgramId ||
                        draggedProgramId === column.id
                      ) {
                        return;
                      }
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      const bounds =
                        event.currentTarget.getBoundingClientRect();
                      setDropTarget({
                        id: column.id,
                        position:
                          event.clientY < bounds.top + bounds.height / 2
                            ? "before"
                            : "after",
                      });
                    }}
                    onDragLeave={(event) => {
                      if (
                        event.relatedTarget instanceof Node &&
                        event.currentTarget.contains(event.relatedTarget)
                      ) {
                        return;
                      }
                      setDropTarget((target) =>
                        target?.id === column.id ? null : target,
                      );
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const sourceId =
                        draggedProgramId ||
                        event.dataTransfer.getData("text/plain");
                      if (sourceId && sourceId !== column.id) {
                        const bounds =
                          event.currentTarget.getBoundingClientRect();
                        onMoveProgram(
                          sourceId,
                          column.id,
                          dropTarget?.id === column.id
                            ? dropTarget.position
                            : event.clientY < bounds.top + bounds.height / 2
                              ? "before"
                              : "after",
                        );
                      }
                      setDraggedProgramId("");
                      setDropTarget(null);
                    }}
                  >
                    <header>
                      <strong>{column.name}</strong>
                      <div className="favorite-column-controls">
                        <span className="favorite-column-count">
                          {column.items.length}
                        </span>
                        {activeFilter === "all" &&
                          !normalizedSearchQuery && (
                          <span
                            className="favorite-drag-handle"
                            role="button"
                            tabIndex={0}
                            draggable
                            aria-label={`拖动“${column.name}”调整上下顺序；也可以使用上下方向键`}
                            title="拖动调整顺序"
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData(
                                "text/plain",
                                column.id,
                              );
                              setDraggedProgramId(column.id);
                            }}
                            onDragEnd={() => {
                              setDraggedProgramId("");
                              setDropTarget(null);
                            }}
                            onKeyDown={(event) => {
                              if (
                                event.key !== "ArrowUp" &&
                                event.key !== "ArrowDown"
                              ) {
                                return;
                              }
                              event.preventDefault();
                              onMoveProgramByOffset(
                                column.id,
                                event.key === "ArrowUp" ? -1 : 1,
                              );
                            }}
                          >
                            拖动排序
                          </span>
                        )}
                      </div>
                    </header>
                    <div>
                      {column.items.map((favorite) => (
                        <article
                          className={`favorite-mini-card ${
                            currentEpisodeId === favorite.id ? "current" : ""
                          }`}
                          key={favorite.id}
                        >
                          <FavoriteCover episode={favorite} />
                          <div>
                            <span>{favorite.programTitle ?? "凹凸宇宙"}</span>
                            <strong>{favorite.title}</strong>
                          </div>
                          <div className="favorite-mini-actions">
                            <HeartButton
                              saved
                              label={favorite.title}
                              onClick={() => onToggleFavorite(favorite)}
                            />
                            <button
                              type="button"
                              disabled={busyEpisodeId === favorite.id}
                              onClick={() => onPlay(favorite)}
                            >
                              {busyEpisodeId === favorite.id
                                ? "载入中"
                                : currentEpisodeId === favorite.id
                                  ? "当前"
                                  : "播放"}
                            </button>
                            <button
                              type="button"
                              onClick={() => onAddToPlaylist(favorite)}
                            >
                              加入其他列表
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ))
              )}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
