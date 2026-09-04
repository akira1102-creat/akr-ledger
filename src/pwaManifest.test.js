import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const worker = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const origin = "https://example.test";
const paths = ["/akr-ledger/manifest.json", "/akr-ledger/assets/manifest-D8D8Hmm9.json"];

function manifestRequest(path, offline) {
  const handlers = {};
  const networkCalls = [];
  const cacheWrites = [];
  const previousManifest = JSON.stringify({ theme_color: "#F8F9FA" });
  runInNewContext(worker, {
    self: { addEventListener: (name, handler) => { handlers[name] = handler; } },
    location: { origin }, URL, Response,
    caches: {
      match: async () => new Response(previousManifest),
      open: async () => ({ put: async (request, response) => {
        cacheWrites.push(response.json());
      } }),
    },
    fetch: async (request, options) => {
      networkCalls.push(options.cache);
      if (offline) throw new Error("offline");
      return Response.json({ theme_color: "#1f2937" });
    },
  });
  let response;
  handlers.fetch({
    request: new Request(origin + path),
    respondWith: pending => { response = pending; },
  });
  return { response, networkCalls, cacheWrites };
}

test("installed manifest URLs fetch updated colors instead of returning a stale cache", async () => {
  for (const path of paths) {
    const result = manifestRequest(path, false);
    assert.deepEqual(await (await result.response).json(), { theme_color: "#1f2937" });
    assert.deepEqual(result.networkCalls, ["no-store"]);
    assert.deepEqual(await Promise.all(result.cacheWrites), [{ theme_color: "#1f2937" }]);
  }
});

test("both installed manifest URLs remain readable offline", async () => {
  for (const path of paths) {
    const result = manifestRequest(path, true);
    assert.deepEqual(await (await result.response).json(), { theme_color: "#F8F9FA" });
    assert.deepEqual(result.cacheWrites, []);
  }
});
