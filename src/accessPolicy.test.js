import assert from "node:assert/strict";
import test from "node:test";
import { allFeaturesEnabled } from "./accessPolicy.js";

test("all features stay enabled regardless of account state", () => {
  assert.equal(allFeaturesEnabled(), true);
  assert.equal(allFeaturesEnabled(null), true);
  assert.equal(allFeaturesEnabled({ status: "inactive" }), true);
});
