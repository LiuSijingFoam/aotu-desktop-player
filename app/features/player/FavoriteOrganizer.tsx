"use client";

import { FormEvent, useEffect, useState } from "react";
import type { FavoriteCategory, FavoriteEpisode } from "./favorites";

export function FavoriteOrganizer({
  favorite,
  categories,
  onClose,
  onCreateCategory,
  onRemove,
  onToggleCategory,
}: {
  favorite: FavoriteEpisode;
  categories: FavoriteCategory[];
  onClose: () => void;
  onCreateCategory: (name: string) => void;
  onRemove: () => void;
  onToggleCategory: (categoryId: string, selected: boolean) => void;
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
    if (!name.trim()) return;
    onCreateCategory(name);
    setName("");
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="favorite-organizer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="favorite-organizer-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="dialog-close" type="button" onClick={onClose}>
          关闭
        </button>
        <span className="eyebrow">特别收藏 · 分类整理</span>
        <h2 id="favorite-organizer-title">{favorite.title}</h2>
        <p>
          可同时放入多个分类；不选择分类时，这期节目会留在“未分类”。
        </p>
        <div className="favorite-program-source">
          <span>所属栏目</span>
          <strong>{favorite.programTitle ?? "栏目未知"}</strong>
          <small>系统会自动按这个栏目归类</small>
        </div>

        <div className="favorite-category-checks">
          {categories.length === 0 ? (
            <span className="favorite-no-categories">先创建一个收藏分类</span>
          ) : (
            categories.map((category) => (
              <label key={category.id}>
                <input
                  type="checkbox"
                  checked={favorite.categoryIds.includes(category.id)}
                  onChange={(event) =>
                    onToggleCategory(category.id, event.target.checked)
                  }
                />
                <span>{category.name}</span>
              </label>
            ))
          )}
        </div>

        <form className="favorite-category-form" onSubmit={submit}>
          <label htmlFor="favorite-category-name">新分类名称</label>
          <div>
            <input
              id="favorite-category-name"
              value={name}
              maxLength={24}
              placeholder="例如：通勤路上"
              onChange={(event) => setName(event.target.value)}
            />
            <button type="submit" disabled={!name.trim()}>
              创建
            </button>
          </div>
        </form>

        <button className="favorite-remove-button" type="button" onClick={onRemove}>
          从特别收藏中移除
        </button>
      </section>
    </div>
  );
}
