import assert from "node:assert/strict";
import test from "node:test";
import { waitForInitialAuthState, withTimeout } from "./firebaseAsync.js";

test("waitForInitialAuthState waits for Firebase's first restored user", async () => {
  const restoredUser = { uid: "test-user" };
  let unsubscribed = false;
  const auth = {
    onAuthStateChanged(onUser) {
      queueMicrotask(() => onUser(restoredUser));
      return () => { unsubscribed = true; };
    },
  };

  assert.equal(await waitForInitialAuthState(auth), restoredUser);
  await Promise.resolve();
  assert.equal(unsubscribed, true);
});

test("withTimeout returns a fast Firebase result", async () => {
  assert.equal(await withTimeout(Promise.resolve("ok"), 50, "逾時"), "ok");
});

test("withTimeout stops an indefinitely pending operation", async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 10, "同步逾時"),
    /同步逾時/,
  );
});
