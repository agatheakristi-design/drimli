import { legalDocumentResponse } from "@/lib/legalDocument";

export const runtime = "nodejs";

export async function GET() {
  return legalDocumentResponse({
    anchor: "i-cadre-contractuel-general",
    title: "Conditions générales | Drimli",
  });
}
