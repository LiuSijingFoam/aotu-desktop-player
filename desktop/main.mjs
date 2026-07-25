import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  session,
} from "electron";
import electronUpdater from "electron-updater";
import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import path from "node:path";
import { createMemberSessionStore } from "./member-session-store.mjs";
import { createSessionPersistence } from "./session-persistence.mjs";

const { autoUpdater } = electronUpdater;
const APP_NAME = "凹凸宇宙桌面收听";
const LOOPBACK_HOST = "127.0.0.1";
const ACCESS_HEADER = "x-aotu-desktop-key";
const UPDATE_STATUS_CHANNEL = "desktop-update:status";
const UPDATE_GET_STATUS_CHANNEL = "desktop-update:get-status";
const UPDATE_CHECK_CHANNEL = "desktop-update:check";
const UPDATE_INSTALL_CHANNEL = "desktop-update:install";

// This is a dedicated audio player; a user selecting an episode should be
// allowed to start playback after the app finishes resolving its stream URL.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const STATIC_CONTENT_TYPES = new Map([
  [".avif", "image/avif"],
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "application/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

let mainWindow;
let localServer;
let isQuitting = false;
let windowOrigin;
let windowOpenDevTools = false;
let updateCheckPromise;
let memberSessionStore;
let desktopSessionPersistence;
let quitStorageFlushed = false;
let quitStorageFlushPromise;
let updateState = {
  phase: app.isPackaged ? "idle" : "unsupported",
  currentVersion: app.getVersion(),
  latestVersion: null,
  percent: null,
  transferred: null,
  total: null,
  errorMessage: null,
};

function logFilePath() {
  return path.join(app.getPath("userData"), "desktop.log");
}

function logEvent(level, event, details = {}) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details,
  });
  fs.appendFile(logFilePath(), `${entry}\n`, () => {});
}

function publicUpdateState() {
  return { ...updateState };
}

function publishUpdateState(nextState) {
  updateState = { ...updateState, ...nextState };
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(UPDATE_STATUS_CHANNEL, publicUpdateState());
    }
  }
}

function updateErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/net::|network|timed? ?out|internet|ENOTFOUND|ECONN/i.test(message)) {
    return "网络连接不稳定，暂时无法完成更新。";
  }
  return "更新暂时未能完成，请稍后重试。";
}

function trustedIpcSender(event) {
  if (!windowOrigin) return false;
  try {
    return new URL(event.senderFrame.url).origin === windowOrigin;
  } catch {
    return false;
  }
}

function setupDesktopSessionPersistence() {
  desktopSessionPersistence = createSessionPersistence({
    cookies: session.defaultSession.cookies,
    flushStorageData: () => session.defaultSession.flushStorageData(),
    onResult: ({ ok, reason, errors }) => {
      logEvent(ok ? "info" : "error", "session-storage-flushed", {
        reason,
        ...(errors.length > 0 ? { detail: errors.join("; ") } : {}),
      });
    },
  });
  desktopSessionPersistence.start();
}

async function flushDesktopSessionStorage(reason) {
  await memberSessionStore?.flush();
  if (!desktopSessionPersistence) return;
  await desktopSessionPersistence.flush(reason);
}

function memberSessionStorePath() {
  return path.join(app.getPath("userData"), "member-session.bin");
}

async function removePrivateFile(filePath) {
  try {
    await fsPromises.rm(filePath);
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
}

async function setupMemberSessionStore() {
  const storePath = memberSessionStorePath();
  memberSessionStore = createMemberSessionStore({
    cookies: session.defaultSession.cookies,
    cookieUrl: `http://${LOOPBACK_HOST}`,
    readEncrypted: () => fsPromises.readFile(storePath),
    writeEncrypted: (encrypted) => writePrivateFile(storePath, encrypted),
    removeEncrypted: () => removePrivateFile(storePath),
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (encrypted) => safeStorage.decryptString(encrypted),
    onResult: ({ operation, ok, detail }) => {
      logEvent(ok ? "info" : "error", "member-session-store", {
        operation,
        ...(detail ? { detail } : {}),
      });
    },
  });
  const restored = await memberSessionStore.restore();
  logEvent("info", "member-session-store-ready", {
    status: restored.status,
  });
  memberSessionStore.start();
}

function closeLocalServer() {
  localServer?.closeAllConnections?.();
  localServer?.close();
}

async function checkForDesktopUpdate() {
  if (!app.isPackaged) return publicUpdateState();
  if (updateCheckPromise) return updateCheckPromise;

  publishUpdateState({
    phase: "checking",
    errorMessage: null,
  });
  updateCheckPromise = autoUpdater
    .checkForUpdates()
    .catch((error) => {
      logEvent("error", "update-check-failed", {
        detail: error instanceof Error ? error.message : String(error),
      });
      publishUpdateState({
        phase: "error",
        errorMessage: updateErrorMessage(error),
      });
      return null;
    })
    .finally(() => {
      updateCheckPromise = undefined;
    });
  await updateCheckPromise;
  return publicUpdateState();
}

function setupDesktopUpdates() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = {
    info: (...details) =>
      logEvent("info", "auto-updater", { detail: details.join(" ") }),
    warn: (...details) =>
      logEvent("warn", "auto-updater", { detail: details.join(" ") }),
    error: (...details) =>
      logEvent("error", "auto-updater", { detail: details.join(" ") }),
    debug: (...details) =>
      logEvent("info", "auto-updater-debug", { detail: details.join(" ") }),
  };

  autoUpdater.on("checking-for-update", () => {
    publishUpdateState({
      phase: "checking",
      errorMessage: null,
    });
  });
  autoUpdater.on("update-available", (info) => {
    logEvent("info", "update-available", {
      currentVersion: app.getVersion(),
      latestVersion: info.version,
    });
    publishUpdateState({
      phase: "available",
      latestVersion: info.version,
      percent: 0,
      transferred: 0,
      total: null,
      errorMessage: null,
    });
  });
  autoUpdater.on("update-not-available", (info) => {
    logEvent("info", "update-not-available", {
      currentVersion: app.getVersion(),
      latestVersion: info.version,
    });
    publishUpdateState({
      phase: "up-to-date",
      latestVersion: info.version,
      percent: null,
      transferred: null,
      total: null,
      errorMessage: null,
    });
  });
  autoUpdater.on("download-progress", (progress) => {
    publishUpdateState({
      phase: "downloading",
      percent: Math.max(0, Math.min(100, progress.percent)),
      transferred: progress.transferred,
      total: progress.total,
      errorMessage: null,
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    logEvent("info", "update-downloaded", {
      currentVersion: app.getVersion(),
      latestVersion: info.version,
    });
    publishUpdateState({
      phase: "ready",
      latestVersion: info.version,
      percent: 100,
      transferred: null,
      total: null,
      errorMessage: null,
    });
  });
  autoUpdater.on("error", (error) => {
    logEvent("error", "auto-updater-error", {
      detail: error instanceof Error ? error.message : String(error),
    });
    publishUpdateState({
      phase: "error",
      errorMessage: updateErrorMessage(error),
    });
  });

  setTimeout(() => {
    void checkForDesktopUpdate();
  }, 3_000);
}

function setupDesktopUpdateIpc() {
  ipcMain.handle(UPDATE_GET_STATUS_CHANNEL, (event) => {
    if (!trustedIpcSender(event)) return null;
    return publicUpdateState();
  });
  ipcMain.handle(UPDATE_CHECK_CHANNEL, (event) => {
    if (!trustedIpcSender(event)) return null;
    return checkForDesktopUpdate();
  });
  ipcMain.handle(UPDATE_INSTALL_CHANNEL, async (event) => {
    if (!trustedIpcSender(event) || updateState.phase !== "ready") {
      return false;
    }
    logEvent("info", "update-install-requested", {
      currentVersion: app.getVersion(),
      latestVersion: updateState.latestVersion,
    });
    await flushDesktopSessionStorage("update-install");
    quitStorageFlushed = true;
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return true;
  });
}

function runtimeConfigPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "desktop-runtime.json")
    : path.join(app.getAppPath(), ".desktop", "runtime-config.json");
}

function serverOutputPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app-dist")
    : path.join(app.getAppPath(), "dist");
}

function constantTimeEqual(left, right) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

async function serveDesktopStaticFile(request, response, clientDir) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;

  let pathname;
  try {
    pathname = decodeURIComponent(
      new URL(request.url ?? "/", "http://localhost").pathname,
    );
  } catch {
    return false;
  }
  if (pathname === "/" || pathname.startsWith("/api/")) return false;

  const resolvedClientDir = path.resolve(clientDir);
  const targetPath = path.resolve(
    resolvedClientDir,
    pathname.replace(/^[/\\]+/, ""),
  );
  if (
    targetPath !== resolvedClientDir &&
    !targetPath.startsWith(`${resolvedClientDir}${path.sep}`)
  ) {
    return false;
  }

  let stat;
  try {
    stat = await fsPromises.stat(targetPath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  const contentType =
    STATIC_CONTENT_TYPES.get(path.extname(targetPath).toLowerCase()) ??
    "application/octet-stream";
  response.writeHead(200, {
    "Cache-Control": pathname.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "public, max-age=3600",
    "Content-Length": String(stat.size),
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  });
  if (request.method === "HEAD") {
    response.end();
  } else {
    fs.createReadStream(targetPath).pipe(response);
  }
  return true;
}

function protectServer(server, accessKey, clientDir) {
  const listeners = server.listeners("request");
  if (listeners.length === 0) {
    throw new Error("本地服务没有可保护的请求处理器。");
  }

  server.removeAllListeners("request");
  server.on("request", async (request, response) => {
    const rawHeader = request.headers[ACCESS_HEADER];
    const provided = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (
      typeof provided !== "string" ||
      !constantTimeEqual(provided, accessKey)
    ) {
      logEvent("warn", "local-request-denied", {
        method: request.method,
        pathname: new URL(request.url ?? "/", "http://localhost").pathname,
      });
      response.writeHead(403, {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end("Forbidden");
      return;
    }

    if (await serveDesktopStaticFile(request, response, clientDir)) return;

    for (const listener of listeners) {
      listener.call(server, request, response);
    }
  });
}

async function readRuntimeConfig() {
  const configPath = runtimeConfigPath();
  let parsed;
  try {
    parsed = JSON.parse(await fsPromises.readFile(configPath, "utf8"));
  } catch (error) {
    throw new Error(
      `缺少桌面运行配置。请先运行 npm run desktop:prepare。\n${error instanceof Error ? error.message : ""}`,
    );
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof parsed.AOTU_MEDIA_SALT !== "string" ||
    parsed.AOTU_MEDIA_SALT.length < 16
  ) {
    throw new Error("桌面运行配置中的媒体签名值无效。");
  }

  const allowedKeys = [
    "AOTU_MEDIA_SALT",
    "AOTU_API_BASE_URL",
    "AOTU_H5_HOME_URL",
    "AOTU_APP_USER_AGENT",
    "AOTU_PUBLIC_USER_AGENT",
  ];
  for (const key of allowedKeys) {
    const value = parsed[key];
    if (typeof value === "string" && value.trim()) {
      process.env[key] = value.trim();
    }
  }
}

async function writePrivateFile(filePath, content) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fsPromises.writeFile(temporaryPath, content, { mode: 0o600 });
  await fsPromises.rename(temporaryPath, filePath);
}

async function loadSessionSecret() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Windows 安全存储当前不可用，无法保护登录会话。");
  }

  const secretPath = path.join(app.getPath("userData"), "session-secret.bin");
  try {
    const encrypted = await fsPromises.readFile(secretPath);
    const secret = safeStorage.decryptString(encrypted);
    if (secret.length < 32) throw new Error("已保存的会话密钥长度不足。");
    return secret;
  } catch (error) {
    const isMissing =
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT";
    if (!isMissing) {
      throw new Error("无法解密本机登录会话，请删除应用数据后重试。");
    }
  }

  await fsPromises.mkdir(app.getPath("userData"), { recursive: true });
  const secret = randomBytes(32).toString("base64url");
  await writePrivateFile(secretPath, safeStorage.encryptString(secret));
  return secret;
}

function attachDesktopRequestKey(port, accessKey) {
  const origin = `http://${LOOPBACK_HOST}:${port}`;
  const requestFilter = {
    urls: ["<all_urls>"],
  };
  session.defaultSession.webRequest.onBeforeSendHeaders(
    requestFilter,
    (details, callback) => {
      if (new URL(details.url).origin === origin) {
        details.requestHeaders[ACCESS_HEADER] = accessKey;
      }
      callback({ requestHeaders: details.requestHeaders });
    },
  );
}

function createWindow(origin, { openDevTools = false } = {}) {
  windowOrigin = origin;
  windowOpenDevTools = openDevTools;
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#171716",
    ...(process.platform === "win32"
      ? {
          titleBarStyle: "hidden",
          titleBarOverlay: {
            color: "#171716",
            symbolColor: "#f5f1ea",
            height: 40,
          },
        }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
      preload: path.join(app.getAppPath(), "desktop", "preload.mjs"),
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription) => {
      logEvent("error", "renderer-load-failed", {
        errorCode,
        errorDescription,
      });
    },
  );
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    logEvent("error", "renderer-process-gone", {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
  mainWindow.webContents.on("did-finish-load", () => {
    logEvent("info", "renderer-loaded");
    if (openDevTools) {
      mainWindow?.webContents.openDevTools({ mode: "detach" });
    }
  });
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (new URL(targetUrl).origin !== origin) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
  void mainWindow.loadURL(origin);
}

async function startDesktop() {
  await readRuntimeConfig();
  process.env.AOTU_COOKIE_SECURE = "0";

  const developmentUrl = !app.isPackaged
    ? process.env.AOTU_DESKTOP_DEV_URL?.trim()
    : undefined;
  if (developmentUrl) {
    const origin = new URL(developmentUrl).origin;
    logEvent("info", "development-server-connected", { origin });
    createWindow(origin, {
      openDevTools: process.env.AOTU_DESKTOP_OPEN_DEVTOOLS !== "0",
    });
    return;
  }

  process.env.AOTU_SESSION_SECRET = await loadSessionSecret();
  const outDir = serverOutputPath();
  if (!fs.existsSync(path.join(outDir, "server", "index.js"))) {
    throw new Error("缺少桌面应用构建产物，请先运行 npm run build。");
  }

  const accessKey = randomBytes(32).toString("base64url");
  const { startProdServer } = await import("vinext/server/prod-server");
  const started = await startProdServer({
    host: LOOPBACK_HOST,
    port: 0,
    outDir,
    noCompression: false,
  });
  localServer = started.server;
  protectServer(localServer, accessKey, path.join(outDir, "client"));
  attachDesktopRequestKey(started.port, accessKey);
  logEvent("info", "local-server-started", {
    host: LOOPBACK_HOST,
    port: started.port,
  });
  createWindow(`http://${LOOPBACK_HOST}:${started.port}`);
}

function focusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", focusMainWindow);
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", (event) => {
    isQuitting = true;
    if (quitStorageFlushed || !desktopSessionPersistence) {
      closeLocalServer();
      return;
    }

    event.preventDefault();
    if (quitStorageFlushPromise) return;
    quitStorageFlushPromise = flushDesktopSessionStorage("before-quit").finally(
      () => {
        quitStorageFlushed = true;
        closeLocalServer();
        app.quit();
      },
    );
  });
  app.on("activate", () => {
    if (!mainWindow && windowOrigin) {
      createWindow(windowOrigin, { openDevTools: windowOpenDevTools });
    }
  });

  app
    .whenReady()
    .then(async () => {
      app.setName(APP_NAME);
      app.setAppUserModelId("com.personal.aotu.desktop");
      await setupMemberSessionStore();
      setupDesktopSessionPersistence();
      setupDesktopUpdateIpc();
      setupDesktopUpdates();
      return startDesktop();
    })
    .catch(async (error) => {
      const detail = error instanceof Error ? error.message : String(error);
      logEvent("error", "desktop-start-failed", { detail });
      await dialog.showMessageBox({
        type: "error",
        title: `${APP_NAME}无法启动`,
        message: "本地桌面应用启动失败。",
        detail,
      });
      if (!isQuitting) app.quit();
    });
}
