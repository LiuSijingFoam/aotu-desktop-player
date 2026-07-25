import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  createMemberSessionStore,
  MEMBER_SESSION_COOKIE,
} from "../desktop/member-session-store.mjs";

const COOKIE_URL = "http://127.0.0.1";
const FUTURE_EXPIRY = 2_000_000_000;
const SEALED_COOKIE = "a".repeat(96);

function fakeEncryption() {
  return {
    encrypt: (value) => Buffer.from(`protected:${value}`, "utf8"),
    decrypt: (value) =>
      Buffer.from(value).toString("utf8").replace(/^protected:/, ""),
  };
}

function fakeCookies(initial = []) {
  const cookies = new EventEmitter();
  cookies.values = [...initial];
  cookies.flushes = 0;
  cookies.get = async ({ name }) =>
    cookies.values.filter((cookie) => cookie.name === name);
  cookies.set = async (cookie) => {
    cookies.values = [
      ...cookies.values.filter((item) => item.name !== cookie.name),
      cookie,
    ];
  };
  cookies.flushStore = async () => {
    cookies.flushes += 1;
  };
  return cookies;
}

function storeHarness(cookies, encryptedState) {
  const encryption = fakeEncryption();
  return createMemberSessionStore({
    cookies,
    cookieUrl: COOKIE_URL,
    readEncrypted: async () => {
      if (!encryptedState.value) {
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      }
      return encryptedState.value;
    },
    writeEncrypted: async (value) => {
      encryptedState.value = value;
    },
    removeEncrypted: async () => {
      encryptedState.value = undefined;
    },
    encrypt: encryption.encrypt,
    decrypt: encryption.decrypt,
    now: () => 1_900_000_000_000,
  });
}

test("backs up an inserted session and restores it into a fresh cookie store", async () => {
  const encryptedState = {};
  const sourceCookies = fakeCookies();
  const sourceStore = storeHarness(sourceCookies, encryptedState);
  sourceStore.start();
  sourceCookies.emit(
    "changed",
    {},
    {
      name: MEMBER_SESSION_COOKIE,
      value: SEALED_COOKIE,
      expirationDate: FUTURE_EXPIRY,
    },
    "inserted",
    false,
  );
  await sourceStore.flush();
  assert.ok(Buffer.isBuffer(encryptedState.value));
  assert.doesNotMatch(
    encryptedState.value.toString("utf8"),
    /^{"version"/,
  );

  const targetCookies = fakeCookies();
  const targetStore = storeHarness(targetCookies, encryptedState);
  assert.deepEqual(await targetStore.restore(), { status: "restored" });
  assert.equal(targetCookies.values[0].name, MEMBER_SESSION_COOKIE);
  assert.equal(targetCookies.values[0].value, SEALED_COOKIE);
  assert.equal(targetCookies.values[0].httpOnly, true);
  assert.equal(targetCookies.flushes, 1);
});

test("removes the encrypted session backup when the user logs out", async () => {
  const encryptedState = {};
  const cookies = fakeCookies([
    {
      name: MEMBER_SESSION_COOKIE,
      value: SEALED_COOKIE,
      expirationDate: FUTURE_EXPIRY,
    },
  ]);
  const store = storeHarness(cookies, encryptedState);
  await store.restore();
  assert.ok(encryptedState.value);

  store.start();
  cookies.emit(
    "changed",
    {},
    { name: MEMBER_SESSION_COOKIE },
    "expired-overwrite",
    true,
  );
  await store.flush();
  assert.equal(encryptedState.value, undefined);
});
