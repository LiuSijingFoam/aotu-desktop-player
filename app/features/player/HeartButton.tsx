"use client";

import type { MouseEventHandler } from "react";

export function HeartButton({
  saved,
  label,
  className = "",
  onClick,
}: {
  saved: boolean;
  label: string;
  className?: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
}) {
  return (
    <button
      className={`heart-button ${saved ? "saved" : ""} ${className}`.trim()}
      type="button"
      aria-pressed={saved}
      aria-label={`${saved ? "移出特别收藏" : "加入特别收藏"} ${label}`}
      title={saved ? "移出特别收藏" : "加入特别收藏"}
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 20.4 4.2 13A5.3 5.3 0 0 1 12 5.8 5.3 5.3 0 0 1 19.8 13L12 20.4Z" />
      </svg>
    </button>
  );
}
