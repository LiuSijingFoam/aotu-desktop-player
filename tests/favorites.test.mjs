import assert from "node:assert/strict";
import test from "node:test";
import {
  addFavorite,
  createFavoriteCategory,
  parseFavoriteLibrary,
  removeFavorite,
  serializeFavoriteLibrary,
  setFavoriteCategory,
} from "../app/features/player/favorites.ts";

test("favorites can belong to more than one custom category", () => {
  let library = parseFavoriteLibrary(null);
  library = addFavorite(
    library,
    {
      id: "episode-1",
      title: "值得反复听的一期",
      programId: "program-1",
      programTitle: "凹凸电波",
      audioUrl: "https://temporary.example/audio.mp3",
    },
    100,
  );
  library = createFavoriteCategory(library, "通勤", "commute", 1);
  library = createFavoriteCategory(library, "睡前", "sleep", 2);
  library = setFavoriteCategory(library, "episode-1", "commute", true);
  library = setFavoriteCategory(library, "episode-1", "sleep", true);

  assert.deepEqual(library.items[0].categoryIds, ["commute", "sleep"]);
  assert.equal("audioUrl" in library.items[0], false);
  assert.deepEqual(
    parseFavoriteLibrary(serializeFavoriteLibrary(library)),
    library,
  );
});

test("favorite parser removes invalid category references and supports removal", () => {
  const library = parseFavoriteLibrary(
    JSON.stringify({
      version: 1,
      categories: [{ id: "kept", name: "保留", createdAt: 1 }],
      items: [
        {
          id: "episode-2",
          title: "测试节目",
          savedAt: 10,
          categoryIds: ["kept", "missing"],
        },
      ],
    }),
  );

  assert.deepEqual(library.items[0].categoryIds, ["kept"]);
  assert.equal(removeFavorite(library, "episode-2").items.length, 0);
});
