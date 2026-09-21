import { readFile } from "node:fs/promises";
import path from "node:path";

type LegalEntryPoint = {
  anchor: "i-cadre-contractuel-general" | "privacy-policy";
  title: string;
};

const LEGAL_DOCUMENT_PATH = path.join(
  process.cwd(),
  "public",
  "legal",
  "conditions-generales.html"
);

export async function legalDocumentResponse(entryPoint: LegalEntryPoint) {
  const source = await readFile(LEGAL_DOCUMENT_PATH, "utf8");
  if (entryPoint.anchor === "privacy-policy") {
    return privacyDocumentResponse(source);
  }
  const headBootstrap = `<script id="drimli-legal-entry-head">try{localStorage.setItem('drimliLegalLang','fr')}catch(e){};history.replaceState(null,'',location.pathname+location.search+'#${entryPoint.anchor}');</script>`;
  const scrollBootstrap = `<script id="drimli-legal-entry-scroll">requestAnimationFrame(function(){var target=document.getElementById('${entryPoint.anchor}');if(target)target.scrollIntoView({block:'start'});});</script>`;
  const html = source
    .replace("<title>Drimli Legal</title>", `<title>${entryPoint.title}</title>${headBootstrap}`)
    .replace("</body>", `${scrollBootstrap}</body>`);

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}

// Extract the original section verbatim, including all nested clauses.
// Fail closed if the shared document no longer has the expected structure.
function privacyDocumentResponse(source: string) {
  const start = source.indexOf('<section class="legal-group" id="privacy-policy">');
  if (start < 0) throw new Error("Privacy policy section missing from legal document");
  const sections = /<section\b[^>]*>|<\/section\s*>/g;
  sections.lastIndex = start;
  let depth = 0;
  let end = -1;
  for (let match = sections.exec(source); match; match = sections.exec(source)) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) {
      end = sections.lastIndex;
      break;
    }
  }
  if (end < 0) throw new Error("Privacy policy section is incomplete");
  const policy = source.slice(start, end);
  const styles = source.match(/<style\b[^>]*>[\s\S]*?<\/style>/g)?.join("\n") ?? "";
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Politique de confidentialité | Drimli</title>
<meta name="description" content="Consultez la politique de confidentialité de Drimli : traitement des données personnelles, données Google, conservation et droits des utilisateurs." />
<link rel="canonical" href="https://www.drimli.io/privacy" />
${styles}
<style>
.privacy-page{max-width:960px;margin:0 auto;padding:40px 24px 80px}
.privacy-page h1{font-size:clamp(30px,5vw,44px);line-height:1.15;color:var(--ink);margin:32px 0 40px}
.privacy-page .legal-group{margin-bottom:0}
.privacy-page > a{color:var(--ink)}
</style>
</head>
<body>
<main class="privacy-page">
<a href="/" aria-label="Drimli — accueil">Drimli</a>
<h1>Politique de confidentialité</h1>
${policy}
</main>
</body>
</html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
