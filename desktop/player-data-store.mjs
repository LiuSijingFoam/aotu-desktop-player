const STORE_VERSION = 1;
const ALLOWED_KEYS = new Set(["history", "programPreferences", "favorites"]);
const MAX_VALUE_BYTES = 512 * 1024;

function emptyState() {
  return {
    version: STORE_VERSION,
    history: null,
    programPreferences: null,
    favorites: null,
  };
}

function clone(value) {
  if (value === null || value === undefined) return value ?? null;
  return JSON.parse(JSON.stringify(value));
}

export function createPlayerDataStore({ read, write, onResult = () => {} }) {
  let state = emptyState();
  let writeQueue = Promise.resolve();

  async function load() {
    try {
      const parsed = JSON.parse(await read());
      if (!parsed || parsed.version !== STORE_VERSION) {
        onResult({ operation: "load", ok: false, detail: "unsupported-version" });
        return;
      }
      state = {
        ...emptyState(),
        history: clone(parsed.history),
        programPreferences: clone(parsed.programPreferences),
        favorites: clone(parsed.favorites),
      };
      onResult({ operation: "load", ok: true });
    } catch (error) {
      const missing =
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT";
      onResult({
        operation: "load",
        ok: missing,
        detail: missing
          ? "new-store"
          : error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }

  function get(key) {
    if (!ALLOWED_KEYS.has(key)) return null;
    return clone(state[key]);
  }

  async function set(key, value) {
    if (!ALLOWED_KEYS.has(key)) return false;
    let nextValue;
    try {
      nextValue = clone(value);
      if (Buffer.byteLength(JSON.stringify(nextValue), "utf8") > MAX_VALUE_BYTES) {
        return false;
      }
    } catch {
      return false;
    }

    state = { ...state, [key]: nextValue };
    const serialized = JSON.stringify(state);
    writeQueue = writeQueue
      .catch(() => {})
      .then(() => write(serialized))
      .then(
        () => onResult({ operation: "save", ok: true }),
        (error) => {
          onResult({
            operation: "save",
            ok: false,
            detail: error instanceof Error ? error.message : String(error),
          });
          throw error;
        },
      );
    try {
      await writeQueue;
      return true;
    } catch {
      return false;
    }
  }

  async function flush() {
    try {
      await writeQueue;
      return true;
    } catch {
      return false;
    }
  }

  return { flush, get, load, set };
}
