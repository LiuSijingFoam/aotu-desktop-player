import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlaylist,
  createPlaylistSharePayload,
  filterPlaylistEpisodes,
  importPlaylist,
  parsePlaylistLibrary,
  parsePlaylistSharePayload,
  removeEpisodeFromPlaylist,
  serializePlaylistLibrary,
  setEpisodeInPlaylist,
} from "../app/features/player/playlists.ts";
import {
  decodePlaylistQrData,
  encodePlaylistQrData,
} from "../app/features/player/playlist-image.ts";
import { filterEpisodesByQuery } from "../app/features/player/episode-search.ts";

const episode = {
  id: "101",
  title: "适合通勤的一期",
  description: "不会写入播放列表快照",
  programId: "15",
  programTitle: "凹凸电波",
  coverUrl: "/api/image?url=https%3A%2F%2Fexample.com%2Fcover.jpg",
  audioUrl: "https://temporary.example/audio.mp3",
  duration: 3600,
  isVip: true,
};

test("creates playlists and stores an episode without a temporary audio URL", () => {
  let library = parsePlaylistLibrary(null);
  library = createPlaylist(library, "通勤路上", "commute", 10);
  library = setEpisodeInPlaylist(library, "commute", episode, true, 20);

  assert.equal(library.playlists.length, 1);
  assert.equal(library.playlists[0].items[0].id, "101");
  assert.equal("audioUrl" in library.playlists[0].items[0], false);
  assert.equal("description" in library.playlists[0].items[0], false);
  assert.deepEqual(
    parsePlaylistLibrary(serializePlaylistLibrary(library)),
    library,
  );

  library = removeEpisodeFromPlaylist(library, "commute", "101", 30);
  assert.equal(library.playlists[0].items.length, 0);
});

test("round-trips compact playlist data through the QR payload codec", async () => {
  let library = createPlaylist(
    parsePlaylistLibrary(null),
    "周末慢慢听",
    "weekend",
    10,
  );
  library = setEpisodeInPlaylist(library, "weekend", episode, true, 20);
  const playlist = library.playlists[0];

  const encoded = await encodePlaylistQrData(playlist);
  const decoded = await decodePlaylistQrData(encoded);

  assert.match(encoded, /^AOTUPL1:D:/);
  assert.equal(decoded.name, "周末慢慢听");
  assert.deepEqual(
    decoded.items.map((item) => ({
      id: item.id,
      title: item.title,
      programId: item.programId,
      programTitle: item.programTitle,
      duration: item.duration,
      isVip: item.isVip,
    })),
    [
      {
        id: "101",
        title: "适合通勤的一期",
        programId: "15",
        programTitle: "凹凸电波",
        duration: 3600,
        isVip: true,
      },
    ],
  );
});

test("validates shared data and imports duplicate names as a new playlist", () => {
  let library = createPlaylist(
    parsePlaylistLibrary(null),
    "通勤路上",
    "local",
    1,
  );
  library = setEpisodeInPlaylist(library, "local", episode, true, 2);
  const shared = parsePlaylistSharePayload(
    createPlaylistSharePayload(library.playlists[0]),
  );
  assert.ok(shared);

  const imported = importPlaylist(library, shared, "imported", 3);
  assert.equal(imported.playlists.length, 2);
  assert.equal(imported.playlists[0].name, "通勤路上（导入）");
  assert.equal(imported.playlists[0].items[0].id, "101");
});

test("filters only the current playlist by episode and program text", () => {
  const items = [
    episode,
    {
      ...episode,
      id: "102",
      title: "周末散步指南",
      programTitle: "凹凸茶水间",
      publishedAt: "2026-06-19",
    },
    {
      ...episode,
      id: "103",
      title: "夜间来信",
      programTitle: "故事电台",
    },
  ];

  assert.deepEqual(
    filterPlaylistEpisodes(items, "茶水").map((item) => item.id),
    ["102"],
  );
  assert.deepEqual(
    filterPlaylistEpisodes(items, "周末 茶水").map((item) => item.id),
    ["102"],
  );
  assert.deepEqual(
    filterPlaylistEpisodes(items, "2026-06-19").map((item) => item.id),
    ["102"],
  );
  assert.deepEqual(
    filterPlaylistEpisodes(items, "  ").map((item) => item.id),
    ["101", "102", "103"],
  );
});

test("filters local playlist and history episodes by title and program", () => {
  const items = [
    {
      id: "one",
      title: "婚礼现场的修罗场",
      programTitle: "凹凸茶水间",
      publishedAt: "2026-06-19",
    },
    {
      id: "two",
      title: "适合通勤的一期",
      programTitle: "凹凸电波",
      publishedAt: "2026-05-01",
    },
  ];

  assert.deepEqual(
    filterEpisodesByQuery(items, "婚礼").map((item) => item.id),
    ["one"],
  );
  assert.deepEqual(
    filterEpisodesByQuery(items, "茶水 婚礼").map((item) => item.id),
    ["one"],
  );
  assert.deepEqual(
    filterEpisodesByQuery(items, "电波").map((item) => item.id),
    ["two"],
  );
  assert.deepEqual(filterEpisodesByQuery(items, "不存在"), []);
  assert.deepEqual(
    filterEpisodesByQuery(items, "  ").map((item) => item.id),
    ["one", "two"],
  );
});
