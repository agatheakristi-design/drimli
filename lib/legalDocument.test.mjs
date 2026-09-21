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

test("privacy serves only the complete French policy, verbatim, without JavaScript", async () => {
  const source = await readFile(sourcePath, "utf8");
  const response = await legalDocumentResponse({
    anchor: "privacy-policy",
    title: "Politique de confidentialité | Drimli",
  });
  const html = await response.text();
  const original = source.split('<section class="legal-group" id="privacy-policy">')[1]
    .split('<section class="legal-group" id="data-processing-agreement">')[0].trim();
  const rendered = html.split('<section class="legal-group" id="privacy-policy">')[1]
    .split('</main>')[0].trim();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.equal(rendered, original);
  assert.match(html, /<h1>Politique de confidentialité<\/h1>/);
  assert.match(html, /<title>Politique de confidentialité \| Drimli<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]+"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www.drimli.io\/privacy"/);
  for (let i = 1; i <= 5; i++) assert.ok(html.includes(`12.${i}`));
  assert.match(html, /id="privacy-22-/);
  assert.doesNotMatch(html, /<script|localStorage|scrollIntoView|id="en-privacy-policy"|id="data-processing-agreement"|id="i-cadre-contractuel-general"/);
});

test("terms response remains byte-for-byte identical to the original renderer", async () => {
  const source = await readFile(sourcePath, "utf8");
  const anchor = "i-cadre-contractuel-general";
  const head = `<script id="drimli-legal-entry-head">try{localStorage.setItem('drimliLegalLang','fr')}catch(e){};history.replaceState(null,'',location.pathname+location.search+'#${anchor}');</script>`;
  const scroll = `<script id="drimli-legal-entry-scroll">requestAnimationFrame(function(){var target=document.getElementById('${anchor}');if(target)target.scrollIntoView({block:'start'});});</script>`;
  const expected = source.replace("<title>Drimli Legal</title>", `<title>Conditions générales | Drimli</title>${head}`).replace("</body>", `${scroll}</body>`);
  const response = await legalDocumentResponse({ anchor, title: "Conditions générales | Drimli" });
  assert.equal(await response.text(), expected);
});
