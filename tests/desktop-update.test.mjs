import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createSessionPersistence,
  MEMBER_SESSION_COOKIE,
} from "../desktop/session-persistence.mjs";

const projectRoot = new URL("../", import.meta.url);

test("packages the GitHub updater and its isolated preload bridge", async () => {
  const [packageSource, mainSource, preloadSource] = await Promise.all([
    readFile(new URL("package.json", projectRoot), "utf8"),
    readFile(new URL("desktop/main.mjs", projectRoot), "utf8"),
    readFile(new URL("desktop/preload.cjs", projectRoot), "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);

  assert.equal(packageJson.version, "0.4.1");
  assert.equal(packageJson.dependencies["electron-updater"], "^6.6.2");
  assert.deepEqual(packageJson.build.publish, [
    {
      provider: "github",
      owner: "LiuSijingFoam",
      repo: "aotu-desktop-player",
      releaseType: "release",
    },
  ]);
  assert.match(mainSource, /\.checkForUpdates\(\)/);
  assert.match(mainSource, /autoUpdater\.quitAndInstall\(false, true\)/);
  assert.match(mainSource, /autoUpdater\.autoDownload = true/);
  assert.match(
    mainSource,
    /await flushDesktopSessionStorage\("update-install"\)/,
  );
  assert.match(mainSource, /preload\.cjs/);
  assert.match(preloadSource, /contextBridge\.exposeInMainWorld/);
  assert.match(preloadSource, /require\("electron"\)/);
  assert.match(preloadSource, /desktop-data:get/);
  assert.doesNotMatch(preloadSource, /\bimport\s/);
  assert.doesNotMatch(preloadSource, /executeJavaScript|shell|fs|child_process/);
});

test("builds tagged GitHub releases as Windows installers without Sites metadata", async () => {
  const [workflowSource, prepareSource, viteSource] = await Promise.all([
    readFile(new URL(".github/workflows/release.yml", projectRoot), "utf8"),
    readFile(
      new URL("scripts/prepare-desktop-runtime.mjs", projectRoot),
      "utf8",
    ),
    readFile(new URL("vite.config.ts", projectRoot), "utf8"),
  ]);

  assert.match(workflowSource, /tags:\s*\r?\n\s+- "v\*"/);
  assert.match(workflowSource, /electron-builder -- --win nsis/);
  assert.match(workflowSource, /gh release (create|upload)/);
  assert.match(prepareSource, /"dist", "\.openai"/);
  assert.doesNotMatch(viteSource, /sites-vite-plugin|sites\(\)/);
});

test("flushes the member session cookie immediately and again before quit", async () => {
  const cookies = new EventEmitter();
  let cookieFlushes = 0;
  let storageFlushes = 0;
  cookies.flushStore = async () => {
    cookieFlushes += 1;
  };

  const persistence = createSessionPersistence({
    cookies,
    flushStorageData: async () => {
      storageFlushes += 1;
    },
    delayMs: 0,
  });
  const stop = persistence.start();

  cookies.emit("changed", {}, { name: "unrelated_cookie" }, "inserted", false);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(cookieFlushes, 0);

  cookies.emit(
    "changed",
    {},
    { name: MEMBER_SESSION_COOKIE },
    "inserted",
    false,
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(cookieFlushes, 1);
  assert.equal(storageFlushes, 1);

  const outcome = await persistence.flush("before-quit");
  assert.equal(outcome.ok, true);
  assert.equal(cookieFlushes, 2);
  assert.equal(storageFlushes, 2);
  stop();
});

test("always shows the app version and update controls in the sidebar", async () => {
  const [playerSource, noticeSource] = await Promise.all([
    readFile(
      new URL("app/features/player/PlayerApp.tsx", projectRoot),
      "utf8",
    ),
    readFile(
      new URL("app/features/player/UpdateNotice.tsx", projectRoot),
      "utf8",
    ),
  ]);

  assert.match(playerSource, /<UpdateNotice \/>/);
  assert.match(noticeSource, /应用版本/);
  assert.match(noticeSource, /已是最新版本/);
  assert.match(noticeSource, /检查更新/);
  assert.match(noticeSource, /role="progressbar"/);
  assert.match(noticeSource, /立即重启更新/);
  assert.match(noticeSource, /重新下载/);
});
