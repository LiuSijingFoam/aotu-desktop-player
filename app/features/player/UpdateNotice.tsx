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

type DesktopStorageApi = {
  get: <T>(key: "history" | "programPreferences") => Promise<T | null>;
  set: (
    key: "history" | "programPreferences",
    value: unknown,
  ) => Promise<boolean>;
};

declare global {
  interface Window {
    aotuDesktop?: {
      updates: DesktopUpdateApi;
      storage: DesktopStorageApi;
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

  if (!status) return null;

  const progress = Math.round(status.percent ?? 0);
  const downloaded = formatMegabytes(status.transferred);
  const total = formatMegabytes(status.total);
  const isReady = status.phase === "ready";
  const isError = status.phase === "error";
  const isChecking = status.phase === "checking";
  const hasUpdate =
    status.phase === "available" ||
    status.phase === "downloading" ||
    isReady;
  const canCheck =
    status.phase === "idle" ||
    status.phase === "up-to-date" ||
    isError;

  const handleAction = async () => {
    const updates = window.aotuDesktop?.updates;
    if (!updates) return;
    setActionBusy(true);
    try {
      if (isReady) {
        await updates.install();
      } else {
        const nextStatus = await updates.check();
        if (nextStatus) setStatus(nextStatus);
      }
    } finally {
      setActionBusy(false);
    }
  };

  if (!hasUpdate && !isError) {
    const statusText =
      status.phase === "up-to-date"
        ? "已是最新版本"
        : isChecking
          ? "正在检查更新…"
          : status.phase === "unsupported"
            ? "网页预览模式"
            : "等待检查更新";

    return (
      <section
        className="update-notice is-compact"
        aria-live="polite"
        aria-label="版本与更新"
      >
        <div className="update-compact-row">
          <div>
            <span className="update-notice-kicker">应用版本</span>
            <strong>v{status.currentVersion}</strong>
          </div>
          <span
            className={`update-state ${isChecking ? "is-checking" : ""}`}
          >
            {statusText}
          </span>
        </div>
        {status.phase !== "unsupported" && (
          <button
            className="update-check-action"
            type="button"
            disabled={!canCheck || actionBusy}
            onClick={handleAction}
          >
            {isChecking || actionBusy ? "正在检查…" : "检查更新"}
          </button>
        )}
      </section>
    );
  }

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
          <strong>
            {status.latestVersion ? `v${status.latestVersion}` : "检查失败"}
          </strong>
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
