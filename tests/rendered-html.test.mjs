import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { access, readFile } from "node:fs/promises";
import test, { after } from "node:test";

const projectRoot = new URL("../", import.meta.url);
process.env.AOTU_SESSION_SECRET =
  "test-session-secret-with-more-than-thirty-two-characters";
process.env.AOTU_MEDIA_SALT = "test-media-salt";

const mockApiServer = createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.url?.endsWith("/user/mobilelogin")) {
    response.end(
      JSON.stringify({
        code: 1,
        data: { userinfo: { id: 7, token: "upstream-token-secret" } },
      }),
    );
    return;
  }
  if (request.url?.endsWith("/user/getUserInfo")) {
    response.end(
      JSON.stringify({
        code: 1,
        data: { id: 7, nickname: "测试会员", is_vip: 1 },
      }),
    );
    return;
  }
  if (request.url?.endsWith("/v1.broadcast_api/itemDetail")) {
    response.end(
      JSON.stringify({
        code: 1,
        data: {
          id: 42,
          name: "会员测试单集",
          is_vip: 1,
          time: 120,
          play_url: "https://media.aotuyuzhou.com/uploads/member.m4a",
        },
      }),
    );
    return;
  }
  if (request.url?.endsWith("/v1.broadcast_api/castDetail")) {
    response.end(
      JSON.stringify({
        code: 1,
        data: {
          id: 88,
          name: "凹凸电波",
          items_count: 3,
          last_episode_time: 1_784_764_800,
        },
      }),
    );
    return;
  }
  if (request.url?.endsWith("/v1.broadcast_api/itemsByCast")) {
    response.end(
      JSON.stringify({
        code: 1,
        data: {
          items: {
            current_page: 1,
            last_page: 1,
            total: 3,
            data: [
              { id: 101, name: "第一期", broadcasting_id: 88 },
              { id: 102, name: "第二期", broadcasting_id: 88 },
              { id: 103, name: "第三期", broadcasting_id: 88 },
            ],
          },
        },
      }),
    );
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ code: 0, msg: "Not found" }));
});
await new Promise((resolve) =>
  mockApiServer.listen(0, "127.0.0.1", resolve),
);
const mockApiAddress = mockApiServer.address();
process.env.AOTU_API_BASE_URL = `http://127.0.0.1:${mockApiAddress.port}/api/`;
after(
  () =>
    new Promise((resolve, reject) =>
      mockApiServer.close((error) => (error ? reject(error) : resolve())),
    ),
);

const nativeFetch = globalThis.fetch;
let delegatedFetch = (...args) => nativeFetch(...args);
globalThis.fetch = (...args) => delegatedFetch(...args);

async function worker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

const env = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const context = {
  waitUntil() {},
  passThroughOnException() {},
};

test("server-renders the private desktop player", async () => {
  const response = await (await worker()).fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    env,
    context,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.match(response.headers.get("content-security-policy") ?? "", /media-src 'self'/);
  assert.equal(response.headers.get("x-frame-options"), "DENY");

  const html = await response.text();
  assert.match(html, /凹凸宇宙/);
  assert.match(html, /桌面收听/);
  assert.match(html, /会员登录/);
  assert.match(html, /收听历史/);
  assert.match(html, /全部栏目/);
  assert.match(html, /栏节目单/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("exposes a minimal health check", async () => {
  const response = await (await worker()).fetch(
    new Request("http://localhost/api/health"),
    env,
    context,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("returns a complete program list with pagination metadata", async () => {
  const response = await (await worker()).fetch(
    new Request("http://localhost/api/program?id=88&page=1"),
    env,
    context,
  );
  assert.equal(response.status, 200, await response.clone().text());
  const payload = await response.json();
  assert.equal(payload.program.title, "凹凸电波");
  assert.equal(payload.program.latestEpisodeAt, 1_784_764_800);
  assert.deepEqual(
    payload.episodes.map((episode) => episode.id),
    ["101", "102", "103"],
  );
  assert.deepEqual(payload.pagination, {
    page: 1,
    total: 3,
    hasMore: false,
  });
});

test("removes the starter preview and metadata", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  await assert.rejects(access(new URL("../app/_sites-preview", projectRoot)));
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(layout, /Starter Project|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(layout, /index:\s*false/);
});

test("filters anonymous VIP items from the public feed", async () => {
  delegatedFetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    assert.equal(url.hostname, "m.aotuyuzhou.com");
    assert.equal(init.headers.Origin, "https://m.aotuyuzhou.com");
    return Response.json({
      code: 1,
      data: {
        broad: [
          {
            id: 10,
            name: "公开频道",
            image: "https://media.aotuyuzhou.com/cast.png",
            last_episode_time: 1_784_678_400,
          },
        ],
        items: [
          {
            id: 1,
            name: "公开单集",
            is_vip: 0,
            play_url: "https://media.aotuyuzhou.com/free.m4a",
          },
          {
            id: 2,
            name: "会员单集",
            is_vip: 1,
            play_url: "https://media.aotuyuzhou.com/vip.m4a",
          },
        ],
      },
    });
  };

  try {
    const response = await (await worker()).fetch(
      new Request("http://localhost/api/discovery"),
      env,
      context,
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.source, "public");
    assert.deepEqual(payload.episodes.map((item) => item.id), ["1"]);
    assert.match(payload.programs[0].coverUrl, /^\/api\/image\?url=/);
    assert.equal(payload.programs[0].latestEpisodeAt, 1_784_678_400);
  } finally {
    delegatedFetch = (...args) => nativeFetch(...args);
  }
});

test("keeps pinned programs first and sorts update times stably", async () => {
  const {
    parseProgramPreferences,
    serializeProgramPreferences,
    sortPrograms,
  } = await import("../app/features/player/program-preferences.ts");
  const programs = [
    { id: "old", title: "乙栏目", latestEpisodeAt: 100, episodeCount: 20 },
    { id: "unknown", title: "甲栏目", episodeCount: 80 },
    { id: "new", title: "丙栏目", latestEpisodeAt: 300, episodeCount: 10 },
    { id: "same", title: "丁栏目", latestEpisodeAt: 300, episodeCount: 10 },
  ];

  assert.deepEqual(
    sortPrograms(programs, ["old"], "latest-desc").map((item) => item.id),
    ["old", "new", "same", "unknown"],
  );
  assert.deepEqual(
    sortPrograms(programs, [], "latest-asc").map((item) => item.id),
    ["old", "new", "same", "unknown"],
  );
  assert.deepEqual(
    sortPrograms(programs, ["unknown"], "episode-count").map((item) => item.id),
    ["unknown", "old", "new", "same"],
  );

  const parsed = parseProgramPreferences(
    JSON.stringify({
      version: 1,
      pinnedIds: ["new", "", "new", "old"],
      sort: "latest-desc",
    }),
  );
  assert.deepEqual(parsed.pinnedIds, ["new", "old"]);
  assert.equal(parsed.sort, "latest-desc");
  assert.deepEqual(parseProgramPreferences("{broken"), {
    version: 1,
    pinnedIds: [],
    sort: "platform",
  });
  assert.deepEqual(
    parseProgramPreferences(serializeProgramPreferences(parsed)),
    parsed,
  );
});

test("keeps the upstream token server-side and signs Range media requests", async () => {
  const appWorker = await worker();
  const loginResponse = await appWorker.fetch(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobile: "13800138000", code: "123456" }),
    }),
    env,
    context,
  );
  assert.equal(loginResponse.status, 200, await loginResponse.clone().text());
  const setCookie = loginResponse.headers.get("set-cookie") ?? "";
  assert.doesNotMatch(setCookie, /upstream-token-secret/);
  const sessionCookie = setCookie.match(/aotu_member_session=[^;,\s]+/)?.[0];
  assert.ok(sessionCookie);

  const episodeResponse = await appWorker.fetch(
    new Request("http://localhost/api/episode?id=42", {
      headers: { Cookie: sessionCookie },
    }),
    env,
    context,
  );
  assert.equal(episodeResponse.status, 200, await episodeResponse.clone().text());
  const episodePayload = await episodeResponse.json();
  assert.doesNotMatch(
    JSON.stringify(episodePayload),
    /upstream-token-secret|media\.aotuyuzhou\.com/,
  );
  assert.match(episodePayload.episode.audioUrl, /^\/api\/stream\?ticket=/);
});

test("generates the APK-compatible media signature and forwards Range", async () => {
  const { buildSignedMediaHeaders } = await import(
    "../app/server/media-signature.ts"
  );
  const playUrl = "https://media.aotuyuzhou.com/uploads/member.m4a";
  const headers = buildSignedMediaHeaders({
    playUrl,
    userId: "7",
    salt: "test-media-salt",
    version: "1.7.43",
    userAgent: "AppVersion:1.7.43;Test#DeviceModel:Test#AndroidVersion:13#APILevel:33#",
    range: "bytes=0-4",
    epochSeconds: 1_750_000_000,
  });
  const tkey = "17500000007";
  const expected = createHash("md5")
    .update(`${playUrl}test-media-salt${tkey}`, "utf8")
    .digest("hex");
  assert.equal(headers.get("authkey"), expected);
  assert.equal(headers.get("tkey"), tkey);
  assert.equal(headers.get("range"), "bytes=0-4");
  assert.equal(headers.get("auto-client"), "autofm-1.7.43");
  assert.equal(headers.get("token"), null);
});
