"use client";

import { FormEvent, type ReactNode, useRef, useState } from "react";
import { HeartButton } from "./HeartButton";
import type { CustomPlaylist, PlaylistLibrary } from "./playlists";
import type { Episode } from "./types";

function formatDuration(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds)) return "--:--";
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remaining = whole % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function PlaylistCover({
  episode,
}: {
  episode: Episode;
}) {
  const [failed, setFailed] = useState(false);
  if (!episode.coverUrl || failed) {
    return (
      <span className="playlist-episode-cover cover-fallback" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    );
  }
  return (
    // Playlist artwork is a catalog image already proxied by the application.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="playlist-episode-cover"
      src={episode.coverUrl}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function PlaylistWorkspace({
  library,
  specialPlaylistId,
  specialPlaylistCount,
  specialContent,
  favoriteIds,
  selectedPlaylistId,
  currentEpisodeId,
  busyEpisodeId,
  activeQueuePlaylistId,
  importing,
  exportingPlaylistId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onPlay,
  onPlayAll,
  onRemove,
  onOpenPicker,
  onToggleFavorite,
  onExport,
  onImport,
}: {
  library: PlaylistLibrary;
  specialPlaylistId: string;
  specialPlaylistCount: number;
  specialContent: ReactNode;
  favoriteIds: Set<string>;
  selectedPlaylistId: string;
  currentEpisodeId?: string;
  busyEpisodeId: string;
  activeQueuePlaylistId: string;
  importing: boolean;
  exportingPlaylistId: string;
  onSelect: (playlistId: string) => void;
  onCreate: (name: string) => void;
  onRename: (playlistId: string, name: string) => void;
  onDelete: (playlist: CustomPlaylist) => void;
  onPlay: (episode: Episode) => void | Promise<void>;
  onPlayAll: (playlist: CustomPlaylist) => void;
  onRemove: (playlistId: string, episodeId: string) => void;
  onOpenPicker: (episode: Episode) => void;
  onToggleFavorite: (episode: Episode) => void;
  onExport: (playlist: CustomPlaylist) => void;
  onImport: (file: File) => void;
}) {
  const [newName, setNewName] = useState("");
  const [renamingPlaylistId, setRenamingPlaylistId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);
  const specialSelected = selectedPlaylistId === specialPlaylistId;
  const selectedPlaylist = specialSelected
    ? null
    : library.playlists.find(
        (playlist) => playlist.id === selectedPlaylistId,
      ) ??
      library.playlists[0] ??
      null;
  const renaming = Boolean(
    selectedPlaylist && renamingPlaylistId === selectedPlaylist.id,
  );

  const submitCreate = (event: FormEvent) => {
    event.preventDefault();
    const normalized = newName.trim();
    if (!normalized) return;
    onCreate(normalized);
    setNewName("");
  };

  const submitRename = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedPlaylist || !renameValue.trim()) return;
    onRename(selectedPlaylist.id, renameValue);
    setRenamingPlaylistId("");
  };

  return (
    <section className="playlist-workspace" aria-labelledby="playlist-heading">
      <div className="section-heading playlist-page-heading">
        <div>
          <span className="eyebrow">保存在这台电脑 · 图片可分享</span>
          <h2 id="playlist-heading">播放列表</h2>
        </div>
        <div className="playlist-page-actions">
          <input
            ref={importInputRef}
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/bmp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = "";
              if (file) onImport(file);
            }}
          />
          <button
            className="secondary-button"
            type="button"
            disabled={importing}
            onClick={() => importInputRef.current?.click()}
          >
            {importing ? "正在识别二维码…" : "导入图片"}
          </button>
        </div>
      </div>

      <div className="playlist-layout">
        <aside className="playlist-rail" aria-label="我的播放列表">
          <form className="playlist-create-form" onSubmit={submitCreate}>
            <label>
              <span>新建播放列表</span>
              <input
                type="text"
                value={newName}
                maxLength={32}
                placeholder="输入列表名称"
                onChange={(event) => setNewName(event.target.value)}
              />
            </label>
            <button type="submit" disabled={!newName.trim()}>
              创建
            </button>
          </form>

          <div className="playlist-rail-list">
            <button
              className={`playlist-special-entry ${
                specialSelected ? "active" : ""
              }`}
              type="button"
              onClick={() => {
                setRenamingPlaylistId("");
                onSelect(specialPlaylistId);
              }}
            >
              <span className="playlist-special-copy">
                <span className="playlist-rail-heart" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M12 20.4 4.2 13A5.3 5.3 0 0 1 12 5.8 5.3 5.3 0 0 1 19.8 13L12 20.4Z" />
                  </svg>
                </span>
                <span>
                  <strong>特别收藏</strong>
                  <small>{specialPlaylistCount} 期 · 按原始栏目归类</small>
                </span>
              </span>
              {activeQueuePlaylistId === specialPlaylistId && <i>播放中</i>}
            </button>
            {library.playlists.length === 0 ? (
              <div className="playlist-rail-empty">
                <strong>还没有自定义列表</strong>
                <span>创建一个列表，或导入朋友分享的图片。</span>
              </div>
            ) : (
              library.playlists.map((playlist) => (
                <button
                  className={
                    selectedPlaylist?.id === playlist.id ? "active" : ""
                  }
                  type="button"
                  key={playlist.id}
                  onClick={() => {
                    setRenamingPlaylistId("");
                    onSelect(playlist.id);
                  }}
                >
                  <span>
                    <strong>{playlist.name}</strong>
                    <small>{playlist.items.length} 期</small>
                  </span>
                  {activeQueuePlaylistId === playlist.id && <i>播放中</i>}
                </button>
              ))
            )}
          </div>
        </aside>

        <div className="playlist-detail" aria-live="polite">
          {specialSelected ? (
            specialContent
          ) : !selectedPlaylist ? (
            <div className="playlist-detail-empty">
              <span className="playlist-empty-mark" aria-hidden="true">
                单
              </span>
              <strong>建立你的第一张节目单</strong>
              <p>
                任何节目右侧都可以选择“加入列表”，也可以从带二维码的图片导入。
              </p>
            </div>
          ) : (
            <>
              <header className="playlist-detail-header">
                <div>
                  <span className="eyebrow">
                    {selectedPlaylist.items.length} 期节目
                    {activeQueuePlaylistId === selectedPlaylist.id
                      ? " · 当前播放队列"
                      : ""}
                  </span>
                  {renaming ? (
                    <form className="playlist-rename-form" onSubmit={submitRename}>
                      <input
                        autoFocus
                        type="text"
                        value={renameValue}
                        maxLength={32}
                        onChange={(event) => setRenameValue(event.target.value)}
                      />
                      <button type="submit" disabled={!renameValue.trim()}>
                        保存
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenamingPlaylistId("")}
                      >
                        取消
                      </button>
                    </form>
                  ) : (
                    <h3>{selectedPlaylist.name}</h3>
                  )}
                </div>
                <div className="playlist-detail-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={selectedPlaylist.items.length === 0}
                    onClick={() => onPlayAll(selectedPlaylist)}
                  >
                    播放全部
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={exportingPlaylistId === selectedPlaylist.id}
                    onClick={() => onExport(selectedPlaylist)}
                  >
                    {exportingPlaylistId === selectedPlaylist.id
                      ? "生成图片中…"
                      : "导出图片"}
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      setRenameValue(selectedPlaylist.name);
                      setRenamingPlaylistId(selectedPlaylist.id);
                    }}
                  >
                    重命名
                  </button>
                  <button
                    className="text-button playlist-delete-button"
                    type="button"
                    onClick={() => onDelete(selectedPlaylist)}
                  >
                    删除
                  </button>
                </div>
              </header>

              {selectedPlaylist.items.length === 0 ? (
                <div className="playlist-detail-empty compact">
                  <strong>这个列表还是空的</strong>
                  <p>从发现页、栏目节目单、历史或其他播放列表中加入节目。</p>
                </div>
              ) : (
                <ol className="playlist-episode-list">
                  {selectedPlaylist.items.map((episode, index) => {
                    const isCurrent = currentEpisodeId === episode.id;
                    return (
                      <li
                        className={isCurrent ? "current" : ""}
                        key={episode.id}
                      >
                        <span className="playlist-episode-index">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <PlaylistCover episode={episode} />
                        <button
                          className="playlist-episode-main"
                          type="button"
                          disabled={busyEpisodeId === episode.id}
                          onClick={() => onPlay(episode)}
                        >
                          <span>{episode.programTitle ?? "凹凸宇宙"}</span>
                          <strong>{episode.title}</strong>
                        </button>
                        <span className="playlist-episode-duration">
                          {formatDuration(episode.duration)}
                        </span>
                        <div className="playlist-episode-actions">
                          <HeartButton
                            saved={favoriteIds.has(episode.id)}
                            label={episode.title}
                            onClick={() => onToggleFavorite(episode)}
                          />
                          <button
                            type="button"
                            onClick={() => onOpenPicker(episode)}
                          >
                            加入其他
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onRemove(selectedPlaylist.id, episode.id)
                            }
                          >
                            移除
                          </button>
                          <button
                            className="playlist-row-play"
                            type="button"
                            disabled={busyEpisodeId === episode.id}
                            onClick={() => onPlay(episode)}
                          >
                            {busyEpisodeId === episode.id
                              ? "载入中"
                              : isCurrent
                                ? "当前"
                                : "播放"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
