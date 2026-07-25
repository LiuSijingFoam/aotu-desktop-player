import assert from "node:assert/strict";
import test from "node:test";
import { createPlayerDataStore } from "../desktop/player-data-store.mjs";

test("persists player history independently from the renderer origin", async () => {
  let stored = "";
  const store = createPlayerDataStore({
    read: async () => {
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    },
    write: async (value) => {
      stored = value;
    },
  });

  await store.load();
  assert.equal(store.get("history"), null);
  assert.equal(
    await store.set("history", [
      {
        id: "episode-1",
        title: "第一期",
        programId: "program-1",
        programTitle: "测试栏目",
        playedAt: 123,
      },
    ]),
    true,
  );
  await store.flush();

  const restored = createPlayerDataStore({
    read: async () => stored,
    write: async () => {},
  });
  await restored.load();
  assert.deepEqual(restored.get("history"), [
    {
      id: "episode-1",
      title: "第一期",
      programId: "program-1",
      programTitle: "测试栏目",
      playedAt: 123,
    },
  ]);
});

test("rejects unknown or oversized desktop data", async () => {
  const store = createPlayerDataStore({
    read: async () => JSON.stringify({ version: 1 }),
    write: async () => {},
  });
  await store.load();

  assert.equal(await store.set("unknown", []), false);
  assert.equal(
    await store.set("history", ["x".repeat(512 * 1024 + 1)]),
    false,
  );
});
