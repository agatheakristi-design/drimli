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
