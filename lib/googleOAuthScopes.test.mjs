import assert from "node:assert/strict";
import test from "node:test";
import { hasGoogleCalendarScope } from "./googleOAuthScopes.ts";

const requiredScope = "https://www.googleapis.com/auth/calendar.events.owned";

test("accepts the exact granted scope alone or among identity scopes", () => {
  for (const scopes of [
    requiredScope,
    `openid email ${requiredScope}`,
    `  ${requiredScope}\t email\nopenid  `,
  ]) {
    assert.equal(hasGoogleCalendarScope(scopes), true);
  }
});

test("rejects missing permissions and other Calendar scopes", () => {
  for (const scopes of [
    undefined,
    null,
    "",
    "openid email",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.events.readonly",
    `${requiredScope}.readonly`,
    `prefix${requiredScope}`,
    `${requiredScope},email`,
  ]) {
    assert.equal(hasGoogleCalendarScope(scopes), false, String(scopes));
  }
});
