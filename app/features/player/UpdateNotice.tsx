"use client";

import { CSSProperties, useEffect, useState } from "react";

type UpdatePhase =
  | "unsupported"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "up-to-date"
  | "error";

type DesktopUpdateState = {
  phase: UpdatePhase;
  currentVersion: string;
  latestVersion: string | null;
  percent: number | null;
  transferred: number | null;
  total: number | null;
  errorMessage: string | null;
};

type DesktopUpdateApi = {
  getStatus: () => Promise<DesktopUpdateState | null>;
  check: () => Promise<DesktopUpdateState | null>;
  install: () => Promise<boolean>;
  onStatus: (listener: (status: DesktopUpdateState) => void) => () => void;
};

declare global {
  interface Window {
    aotuDesktop?: {
      updates: DesktopUpdateApi;
    };
  }
}

function formatMegabytes(bytes: number | null) {
  if (!bytes || !Number.isFinite(bytes)) return null;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function UpdateNotice() {
  const [status, setStatus] = useState<DesktopUpdateState | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    const updates = window.aotuDesktop?.updates;
    if (!updates) return;

    let active = true;
    const removeListener = updates.onStatus((nextStatus) => {
      if (active) setStatus(nextStatus);
    });
    void updates.getStatus().then((nextStatus) => {
      if (active && nextStatus) setStatus(nextStatus);
    });

    return () => {
      active = false;
      removeListener();
    };
  }, []);

  if (
    !status ||
    !(
      status.phase === "available" ||
      status.phase === "downloading" ||
      status.phase === "ready" ||
      (status.phase === "error" && status.latestVersion)
    )
  ) {
    return null;
  }

  const progress = Math.round(status.percent ?? 0);
  const downloaded = formatMegabytes(status.transferred);
  const total = formatMegabytes(status.total);
  const isReady = status.phase === "ready";
  const isError = status.phase === "error";

  const handleAction = async () => {
    const updates = window.aotuDesktop?.updates;
    if (!updates) return;
    setActionBusy(true);
    try {
      if (isReady) {
        await updates.install();
      } else {
        await updates.check();
      }
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <section
      className={`update-notice ${isReady ? "is-ready" : ""} ${
        isError ? "is-error" : ""
      }`}
      aria-live="polite"
      aria-label="应用更新"
    >
      <div className="update-notice-heading">
        <span className="update-notice-icon" aria-hidden="true">
          升
        </span>
        <div>
          <span className="update-notice-kicker">
            {isReady
              ? "更新已就绪"
              : isError
                ? "更新未完成"
                : "发现新版本"}
          </span>
          <strong>v{status.latestVersion}</strong>
        </div>
      </div>

      {isReady ? (
        <p>新版本已经下载完成，重启即可安装。</p>
      ) : isError ? (
        <p>{status.errorMessage ?? "下载暂时中断，请稍后重试。"}</p>
      ) : (
        <>
          <p>
            正在后台下载
            {downloaded && total ? ` · ${downloaded} / ${total}` : "…"}
          </p>
          <div
            className="update-progress"
            role="progressbar"
            aria-label="更新下载进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <span
              style={
                {
                  "--update-progress": progress / 100,
                } as CSSProperties
              }
            />
          </div>
        </>
      )}

      <div className="update-version-line">
        当前版本 v{status.currentVersion}
      </div>

      {(isReady || isError) && (
        <button
          className="update-action"
          type="button"
          disabled={actionBusy}
          onClick={handleAction}
        >
          {actionBusy
            ? isReady
              ? "正在重启…"
              : "正在重试…"
            : isReady
              ? "立即重启更新"
              : "重新下载"}
        </button>
      )}
    </section>
  );
}
