import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { googleScopeDiagnostic, googleConnectionError } from "./googleOAuthDiagnostics.ts";

test("reports absent scope without including any OAuth credentials", () => {
  for (const input of [undefined, null, "", "  ", { access_token: "secret", refresh_token: "secret", id_token: "secret", code: "secret", state: "secret" }]) {
    assert.deepEqual(googleScopeDiagnostic(input), { scopePresent: false, scopes: [] });
  }
});

test("returns only scope identifiers and rejects arbitrary sensitive strings", () => {
  const scope = "https://www.googleapis.com/auth/calendar.events.owned";
  assert.deepEqual(googleScopeDiagnostic(`openid email ${scope}\nopenid`), { scopePresent: true, scopes: ["openid", "email", scope] });
  assert.deepEqual(googleScopeDiagnostic("access_token=secret code=secret state=secret eyJ.secret https://www.googleapis.com/auth/calendar?secret=x"), { scopePresent: true, scopes: [] });
});

test("shows a generic message only for the OAuth error redirect", () => {
  assert.equal(googleConnectionError("?google=error"), "La connexion à Google Meet n'a pas pu être finalisée. Réessayez.");
  for (const search of ["", "?google=connected", "?error=secret"]) assert.equal(googleConnectionError(search), "");
});

test("callback logs only sanitized scopes before the unchanged scope check", async () => {
  const source = await readFile(new URL("../app/api/google/callback/route.ts", import.meta.url), "utf8");
  const diagnostic = 'console.info("[GOOGLE_OAUTH_SCOPES]", googleScopeDiagnostic(tokens.scope));';
  assert.ok(source.includes(diagnostic));
  assert.ok(source.indexOf(diagnostic) > source.indexOf("await oauth2Client.getToken(code)"));
  assert.ok(source.indexOf(diagnostic) < source.indexOf("if (!hasGoogleCalendarScope(returnedScope))"));
});
