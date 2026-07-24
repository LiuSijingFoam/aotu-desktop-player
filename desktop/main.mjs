import {
  app,
  BrowserWindow,
  dialog,
  safeStorage,
  session,
} from "electron";
import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import path from "node:path";

const APP_NAME = "凹凸宇宙桌面收听";
const LOOPBACK_HOST = "127.0.0.1";
const ACCESS_HEADER = "x-aotu-desktop-key";

let mainWindow;
let localServer;
let isQuitting = false;

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

function protectServer(server, accessKey) {
  const listeners = server.listeners("request");
  if (listeners.length === 0) {
    throw new Error("本地服务没有可保护的请求处理器。");
  }

  server.removeAllListeners("request");
  server.on("request", (request, response) => {
    const rawHeader = request.headers[ACCESS_HEADER];
    const provided = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (
      typeof provided !== "string" ||
      !constantTimeEqual(provided, accessKey)
    ) {
      response.writeHead(403, {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end("Forbidden");
      return;
    }

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
  const requestFilter = {
    urls: [`http://${LOOPBACK_HOST}:${port}/*`],
  };
  session.defaultSession.webRequest.onBeforeSendHeaders(
    requestFilter,
    (details, callback) => {
      details.requestHeaders[ACCESS_HEADER] = accessKey;
      callback({ requestHeaders: details.requestHeaders });
    },
  );
}

function createWindow(port) {
  const origin = `http://${LOOPBACK_HOST}:${port}`;
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#171716",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
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
  process.env.AOTU_SESSION_SECRET = await loadSessionSecret();
  process.env.AOTU_COOKIE_SECURE = "0";

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
  protectServer(localServer, accessKey);
  attachDesktopRequestKey(started.port, accessKey);
  createWindow(started.port);
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
  app.on("before-quit", () => {
    isQuitting = true;
    localServer?.closeAllConnections?.();
    localServer?.close();
  });
  app.on("activate", () => {
    if (!mainWindow && localServer?.listening) {
      const address = localServer.address();
      if (address && typeof address === "object") createWindow(address.port);
    }
  });

  app
    .whenReady()
    .then(() => {
      app.setName(APP_NAME);
      app.setAppUserModelId("com.personal.aotu.desktop");
      return startDesktop();
    })
    .catch(async (error) => {
      const detail = error instanceof Error ? error.message : String(error);
      await dialog.showMessageBox({
        type: "error",
        title: `${APP_NAME}无法启动`,
        message: "本地桌面应用启动失败。",
        detail,
      });
      if (!isQuitting) app.quit();
    });
}
