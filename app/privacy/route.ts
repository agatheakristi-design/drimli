import { legalDocumentResponse } from "@/lib/legalDocument";

export const runtime = "nodejs";

export async function GET() {
  return legalDocumentResponse({
    anchor: "privacy-policy",
    title: "Politique de confidentialité | Drimli",
  });
}
