import { MEMBER_SESSION_COOKIE } from "./member-session-store.mjs";
export { MEMBER_SESSION_COOKIE } from "./member-session-store.mjs";

export function createSessionPersistence({
  cookies,
  flushStorageData,
  onResult = () => {},
  delayMs = 100,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let scheduledFlush;
  let activeFlush;
  let stopListening;

  async function flush(reason) {
    if (scheduledFlush !== undefined) {
      cancel(scheduledFlush);
      scheduledFlush = undefined;
    }
    if (activeFlush) return activeFlush;

    activeFlush = Promise.allSettled([
      cookies.flushStore(),
      flushStorageData(),
    ])
      .then((results) => {
        const errors = results
          .filter((result) => result.status === "rejected")
          .map((result) =>
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
          );
        const outcome = {
          ok: errors.length === 0,
          reason,
          errors,
        };
        onResult(outcome);
        return outcome;
      })
      .finally(() => {
        activeFlush = undefined;
      });
    return activeFlush;
  }

  function scheduleFlush(reason) {
    if (scheduledFlush !== undefined) cancel(scheduledFlush);
    scheduledFlush = schedule(() => {
      scheduledFlush = undefined;
      void flush(reason);
    }, delayMs);
  }

  function start() {
    if (stopListening) return stopListening;

    const handleCookieChanged = (_event, cookie) => {
      if (cookie?.name === MEMBER_SESSION_COOKIE) {
        scheduleFlush("member-session-cookie-changed");
      }
    };
    cookies.on("changed", handleCookieChanged);
    stopListening = () => {
      if (scheduledFlush !== undefined) {
        cancel(scheduledFlush);
        scheduledFlush = undefined;
      }
      cookies.removeListener("changed", handleCookieChanged);
      stopListening = undefined;
    };
    return stopListening;
  }

  return {
    flush,
    start,
  };
}
