import test from "node:test";
import assert from "node:assert/strict";
import {
  UPDATE_STATUS,
  parseBuildNumber,
  parseVersionPayload,
  getUpdateStatus,
  isDismissed,
} from "../src/utils/appUpdate.js";

const { NONE, OPTIONAL, MANDATORY } = UPDATE_STATUS;
const status = (currentBuild, latestVersionCode, minimumVersionCode) =>
  getUpdateStatus({ currentBuild, latestVersionCode, minimumVersionCode });

test("no update when current == latest", () => assert.equal(status(6, 6, 5), NONE));
test("no update when current is ahead", () => assert.equal(status(7, 6, 5), NONE));
test("optional when current < latest, >= minimum", () => assert.equal(status(5, 6, 5), OPTIONAL));
test("mandatory only when current < minimum", () => {
  assert.equal(status(4, 6, 5), MANDATORY);
  assert.equal(status(5, 6, 5), OPTIONAL);
});
test("release workflow 5 → 6 → 7", () => {
  assert.equal(status(5, 5, 5), NONE);
  assert.equal(status(5, 6, 5), OPTIONAL);
  assert.equal(status(6, 6, 5), NONE);
  assert.equal(status(6, 7, 5), OPTIONAL);
  assert.equal(status(7, 7, 5), NONE);
});
test("numeric, not string, comparison", () => {
  assert.equal(status(9, 10, 5), OPTIONAL);
  assert.equal(status("9", "10", "5"), OPTIONAL);
});
test("fails open on invalid input", () => {
  for (const bad of [null, undefined, "", "abc", NaN, 0, -1, 1.5]) {
    assert.equal(status(bad, 6, 5), NONE);
    assert.equal(status(5, bad, 5), NONE);
    assert.equal(status(5, 6, bad), NONE);
  }
});
test("parseVersionPayload", () => {
  assert.deepEqual(
    parseVersionPayload({ android: { latestVersionCode: 6, minimumVersionCode: 5 }, message: "Hi" }),
    { latestVersionCode: 6, minimumVersionCode: 5, message: "Hi" }
  );
  assert.equal(parseVersionPayload(null), null);
  assert.equal(parseVersionPayload({ android: { latestVersionCode: 5, minimumVersionCode: 6 } }), null);
});
test("isDismissed", () => {
  const DAY = 86400000, now = 1e12;
  assert.equal(isDismissed({ versionCode: 6, at: now - 1000 }, 6, now, DAY), true);
  assert.equal(isDismissed({ versionCode: 6, at: now - 1000 }, 7, now, DAY), false);
  assert.equal(isDismissed({ versionCode: 6, at: now - DAY - 1 }, 6, now, DAY), false);
});