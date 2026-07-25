export const MEMBER_SESSION_COOKIE = "aotu_member_session";

const STORE_VERSION = 1;
const MAX_COOKIE_LENGTH = 16 * 1024;

function validStoredSession(value, nowSeconds) {
  return (
    value &&
    value.version === STORE_VERSION &&
    typeof value.cookieValue === "string" &&
    value.cookieValue.length >= 32 &&
    value.cookieValue.length <= MAX_COOKIE_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(value.cookieValue) &&
    Number.isFinite(value.expirationDate) &&
    value.expirationDate > nowSeconds
  );
}

export function createMemberSessionStore({
  cookies,
  cookieUrl,
  readEncrypted,
  writeEncrypted,
  removeEncrypted,
  encrypt,
  decrypt,
  now = () => Date.now(),
  onResult = () => {},
}) {
  let operationQueue = Promise.resolve();
  let stopListening;

  function report(operation, ok, detail) {
    onResult({
      operation,
      ok,
      ...(detail ? { detail } : {}),
    });
  }

  function enqueue(operation, task) {
    operationQueue = operationQueue
      .then(task, task)
      .then(
        (result) => {
          report(operation, true);
          return result;
        },
        (error) => {
          report(
            operation,
            false,
            error instanceof Error ? error.message : String(error),
          );
        },
      );
    return operationQueue;
  }

  async function saveCookie(cookie) {
    if (
      !cookie?.value ||
      !Number.isFinite(cookie.expirationDate) ||
      cookie.expirationDate <= now() / 1000
    ) {
      await removeEncrypted();
      return;
    }

    const payload = JSON.stringify({
      version: STORE_VERSION,
      cookieValue: cookie.value,
      expirationDate: cookie.expirationDate,
    });
    await writeEncrypted(encrypt(payload));
  }

  async function restore() {
    const existingCookies = await cookies.get({
      url: cookieUrl,
      name: MEMBER_SESSION_COOKIE,
    });
    const existing = existingCookies.find(
      (cookie) => cookie.name === MEMBER_SESSION_COOKIE,
    );
    if (existing) {
      await enqueue("backup-existing-session", () => saveCookie(existing));
      return { status: "existing" };
    }

    let encrypted;
    try {
      encrypted = await readEncrypted();
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return { status: "empty" };
      }
      report(
        "restore-session",
        false,
        error instanceof Error ? error.message : String(error),
      );
      return { status: "error" };
    }

    try {
      const stored = JSON.parse(decrypt(encrypted));
      if (!validStoredSession(stored, now() / 1000)) {
        await removeEncrypted();
        report("restore-session", false, "saved session is invalid or expired");
        return { status: "invalid" };
      }

      await cookies.set({
        url: cookieUrl,
        name: MEMBER_SESSION_COOKIE,
        value: stored.cookieValue,
        path: "/",
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        expirationDate: stored.expirationDate,
      });
      await cookies.flushStore();
      report("restore-session", true);
      return { status: "restored" };
    } catch (error) {
      await removeEncrypted();
      report(
        "restore-session",
        false,
        error instanceof Error ? error.message : String(error),
      );
      return { status: "invalid" };
    }
  }

  function start() {
    if (stopListening) return stopListening;

    const handleCookieChanged = (_event, cookie, cause, removed) => {
      if (cookie?.name !== MEMBER_SESSION_COOKIE) return;

      if (removed) {
        // Chromium emits an overwrite removal immediately before the new
        // cookie insertion. The following insertion is the state to persist.
        if (cause !== "overwrite") {
          void enqueue("remove-session", removeEncrypted);
        }
        return;
      }
      void enqueue("save-session", () => saveCookie(cookie));
    };

    cookies.on("changed", handleCookieChanged);
    stopListening = () => {
      cookies.removeListener("changed", handleCookieChanged);
      stopListening = undefined;
    };
    return stopListening;
  }

  return {
    flush: () => operationQueue,
    restore,
    start,
  };
}
