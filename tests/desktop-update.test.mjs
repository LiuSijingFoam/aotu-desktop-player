import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

test("packages the GitHub updater and its isolated preload bridge", async () => {
  const [packageSource, mainSource, preloadSource] = await Promise.all([
    readFile(new URL("package.json", projectRoot), "utf8"),
    readFile(new URL("desktop/main.mjs", projectRoot), "utf8"),
    readFile(new URL("desktop/preload.mjs", projectRoot), "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);

  assert.equal(packageJson.version, "0.3.0");
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
  assert.match(mainSource, /preload\.mjs/);
  assert.match(preloadSource, /contextBridge\.exposeInMainWorld/);
  assert.doesNotMatch(preloadSource, /executeJavaScript|shell|fs|child_process/);
});

test("shows update progress and a restart-to-install action in the sidebar", async () => {
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
  assert.match(noticeSource, /role="progressbar"/);
  assert.match(noticeSource, /立即重启更新/);
  assert.match(noticeSource, /重新下载/);
});
