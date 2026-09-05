import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { legalDocumentResponse } from "./legalDocument.ts";

const sourcePath = new URL("../public/legal/conditions-generales.html", import.meta.url);

test("the single legal corpus contains the requested public anchors and support address", async () => {
  const source = await readFile(sourcePath, "utf8");
  assert.match(source, /id="i-cadre-contractuel-general"/);
  assert.match(source, /id="privacy-policy"/);
  assert.match(source, /support@drimli\.io/);
});

test("terms serves the shared corpus with its dedicated metadata and entry anchor", async () => {
  const response = await legalDocumentResponse({
    anchor: "i-cadre-contractuel-general",
    title: "Conditions générales | Drimli",
  });
  const html = await response.text();
  assert.match(html, /<title>Conditions générales \| Drimli<\/title>/);
  assert.match(html, /#i-cadre-contractuel-general/);
  assert.match(html, /getElementById\('i-cadre-contractuel-general'\)/);
});

test("privacy targets the autonomous policy rather than clause XVII", async () => {
  const response = await legalDocumentResponse({
    anchor: "privacy-policy",
    title: "Politique de confidentialité | Drimli",
  });
  const html = await response.text();
  assert.match(html, /<title>Politique de confidentialité \| Drimli<\/title>/);
  assert.match(html, /#privacy-policy/);
  assert.match(html, /getElementById\('privacy-policy'\)/);
  assert.doesNotMatch(html, /drimli-legal-entry-head[^<]+#46-repartition-des-roles/);
});
