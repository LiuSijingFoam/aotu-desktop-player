"use client";

import { FormEvent, useEffect, useState } from "react";
import type { CustomPlaylist } from "./playlists";
import type { Episode } from "./types";

export function PlaylistPicker({
  episode,
  playlists,
  onClose,
  onCreate,
  onToggle,
}: {
  episode: Episode;
  playlists: CustomPlaylist[];
  onClose: () => void;
  onCreate: (name: string) => void;
  onToggle: (playlistId: string, selected: boolean) => void;
}) {
  const [name, setName] = useState("");

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const normalized = name.trim();
    if (!normalized) return;
    onCreate(normalized);
    setName("");
  };

  return (
    <div className="dialog-backdrop">
      <button
        className="dialog-dismiss-layer"
        type="button"
        tabIndex={-1}
        aria-label="关闭加入播放列表窗口"
        onClick={onClose}
      />
      <section
        className="playlist-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="playlist-picker-title"
      >
        <button
          className="dialog-close"
          type="button"
          aria-label="关闭"
          onClick={onClose}
        >
          ×
        </button>
        <span className="eyebrow">加入播放列表</span>
        <h2 id="playlist-picker-title">{episode.title}</h2>
        <p>可以同时加入多个列表，勾选状态会自动保存在这台电脑。</p>

        <div className="playlist-picker-list" aria-live="polite">
          {playlists.length === 0 ? (
            <div className="playlist-picker-empty">
              <strong>还没有播放列表</strong>
              <span>在下方输入名称，即可创建并加入。</span>
            </div>
          ) : (
            playlists.map((playlist) => {
              const selected = playlist.items.some(
                (item) => item.id === episode.id,
              );
              return (
                <label className="playlist-picker-option" key={playlist.id}>
                  <span>
                    <strong>{playlist.name}</strong>
                    <small>{playlist.items.length} 期节目</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={(event) =>
                      onToggle(playlist.id, event.target.checked)
                    }
                  />
                  <i aria-hidden="true" />
                </label>
              );
            })
          )}
        </div>

        <form className="playlist-create-inline" onSubmit={submit}>
          <label>
            <span>新列表名称</span>
            <input
              type="text"
              value={name}
              maxLength={32}
              placeholder="例如：通勤路上"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button type="submit" disabled={!name.trim()}>
            新建并加入
          </button>
        </form>

        <button className="playlist-picker-done" type="button" onClick={onClose}>
          完成
        </button>
      </section>
    </div>
  );
}
