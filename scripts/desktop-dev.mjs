import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { watch } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import electronPath from "electron";

const projectRoot = process.cwd();
const host = process.env.AOTU_DESKTOP_DEV_HOST?.trim() || "127.0.0.1";
const port = Number.parseInt(process.env.AOTU_DESKTOP_DEV_PORT || "3000", 10);
const developmentUrl = `http://${host}:${port}`;
const vinextCli = path.join(
  projectRoot,
  "node_modules",
  "vinext",
  "dist",
  "cli.js",
);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("AOTU_DESKTOP_DEV_PORT 必须是有效端口号。");
}

const sharedEnvironment = {
  ...process.env,
  AOTU_COOKIE_SECURE: "0",
  AOTU_SESSION_SECRET: randomBytes(32).toString("base64url"),
};

let devServer;
let electron;
let desktopWatcher;
let restartTimer;
let restartingElectron = false;
let stopping = false;

function runDesktopPrepare() {
  const result = spawnSync(
    process.execPath,
    [path.join(projectRoot, "scripts", "prepare-desktop-runtime.mjs")],
    {
      cwd: projectRoot,
      env: sharedEnvironment,
      stdio: "inherit",
    },
  );
  if (result.status !== 0) {
    throw new Error("桌面运行配置准备失败。");
  }
}

async function ensurePortAvailable() {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        reject(
          new Error(
            `开发端口 ${port} 已被占用。可设置 AOTU_DESKTOP_DEV_PORT 使用其他端口。`,
          ),
        );
        return;
      }
      reject(error);
    });
    probe.listen(port, host, () => probe.close(resolve));
  });
}

function startDevServer() {
  devServer = spawn(
    process.execPath,
    [vinextCli, "dev", "--hostname", host, "--port", String(port)],
    {
      cwd: projectRoot,
      env: sharedEnvironment,
      stdio: "inherit",
    },
  );
  devServer.once("exit", (code) => {
    if (!stopping) {
      console.error(`开发服务器已退出（代码 ${code ?? "未知"}）。`);
      void stop(code ?? 1);
    }
  });
}

async function waitForDevServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (devServer?.exitCode !== null) {
      throw new Error("开发服务器在准备完成前退出。");
    }
    try {
      const response = await fetch(developmentUrl, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.status < 500) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`开发服务器在 60 秒内未就绪：${developmentUrl}`);
}

function startElectron() {
  electron = spawn(electronPath, ["--inspect=9229", projectRoot], {
    cwd: projectRoot,
    env: {
      ...sharedEnvironment,
      AOTU_DESKTOP_DEV_URL: developmentUrl,
      AOTU_DESKTOP_OPEN_DEVTOOLS:
        process.env.AOTU_DESKTOP_OPEN_DEVTOOLS || "1",
      ELECTRON_ENABLE_LOGGING: "1",
    },
    stdio: "inherit",
  });
  electron.once("exit", (code) => {
    if (stopping || restartingElectron) return;
    console.log("Electron 窗口已关闭，桌面开发模式结束。");
    void stop(code ?? 0);
  });
}

function restartElectron() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (stopping) return;
    console.log("检测到桌面主进程修改，正在重启 Electron…");
    if (!electron || electron.exitCode !== null) {
      startElectron();
      return;
    }
    restartingElectron = true;
    electron.once("exit", () => {
      restartingElectron = false;
      if (!stopping) startElectron();
    });
    electron.kill();
  }, 200);
}

function watchDesktopMainProcess() {
  desktopWatcher = watch(
    path.join(projectRoot, "desktop"),
    { recursive: true },
    (_eventType, filename) => {
      if (!filename || /\.(?:c|m)?js$/i.test(filename)) restartElectron();
    },
  );
}

async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  clearTimeout(restartTimer);
  desktopWatcher?.close();
  if (electron && electron.exitCode === null) electron.kill();
  if (devServer && devServer.exitCode === null) devServer.kill();
  setTimeout(() => process.exit(exitCode), 100).unref();
}

process.once("SIGINT", () => void stop(0));
process.once("SIGTERM", () => void stop(0));

try {
  runDesktopPrepare();
  await ensurePortAvailable();
  startDevServer();
  await waitForDevServer();
  startElectron();
  watchDesktopMainProcess();
  console.log(`桌面开发模式已启动：${developmentUrl}`);
  console.log("React/CSS 会热更新；desktop/ 修改会自动重启 Electron。");
  console.log("渲染进程 DevTools 已打开；主进程调试端口为 9229。");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  await stop(1);
}
