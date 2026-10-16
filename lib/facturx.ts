import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeBillingCountry } from "./billingCountries.mjs";

export type FacturxParty = {
  name: string;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
  vatNumber?: string | null;
  siret?: string | null;
};
export type FacturxDocument = {
  kind: "invoice" | "credit_note";
  number: string;
  issuedAt: string;
  serviceDate?: string | null;
  servicePeriod?: { start: string; end: string };
  serviceRecipientName?: string | null;
  originalInvoiceNumber?: string | null;
  seller: FacturxParty;
  buyer: FacturxParty;
  title: string;
  excludingTax: number;
  vatAmount: number;
  includingTax: number;
  vatRate: number;
  vatRegime?: string | null;
  exemptionMention?: string | null;
  currency: string;
  settled: boolean;
};

class UnsupportedDocument extends Error {}
const value = <T,>(v: T) => ({ value: v });
function countryCode(country?: string | null) {
  const text = country?.trim().toUpperCase();
  if (text === "FRANCE") return "FR";
  const code = normalizeBillingCountry(text);
  if (code) return code;
  throw new UnsupportedDocument("missing_or_unsupported_country");
}
function party(p: FacturxParty, seller: boolean, franchiseBase = false) {
  if (!p.name?.trim()) throw new UnsupportedDocument("missing_party_name");
  if (seller && (!p.address?.trim() || !p.city?.trim() || !p.postalCode?.trim())) throw new UnsupportedDocument("incomplete_seller_address");
  let siren: string | undefined;
  if (seller && franchiseBase) {
    const siret = p.siret?.replace(/\s/g, "") || "";
    if (/^\d{14}$/.test(siret) && !/^0+$/.test(siret)) {
      const candidate = siret.slice(0, 9);
      const checksum = [...candidate].reduce((sum, digit, index) => {
        const n = Number(digit) * (index % 2 === 1 ? 2 : 1);
        return sum + (n > 9 ? n - 9 : n);
      }, 0);
      if (checksum % 10 === 0 && !/^0+$/.test(candidate)) siren = candidate;
    }
    if (!p.vatNumber?.trim() && !siren) throw new UnsupportedDocument("franchise_base_missing_valid_siren_from_siret");
  }
  return {
    name: value(p.name),
    ...(siren ? { specifiedLegalOrganization: { id: { value: siren, schemeID: "0002" } } } : {}),
    postalTradeAddress: {
      ...(p.address ? { lineOne: value(p.address) } : {}),
      ...(p.postalCode ? { postcodeCode: value(p.postalCode) } : {}),
      ...(p.city ? { cityName: value(p.city) } : {}),
      countryID: value(countryCode(p.country)),
    },
    ...(p.vatNumber?.trim() ? { specifiedTaxRegistration: [{ id: { value: p.vatNumber.replace(/\s/g, ""), schemeID: "VA" } }] }
      : siren ? { specifiedTaxRegistration: [{ id: { value: siren, schemeID: "FC" } }] } : {}),
  };
}

const FRANCHISE_BASE_MENTION = "TVA non applicable, art. 293 B du CGI";

/** Only the existing, explicit French 293 B declaration is supported alongside
 * standard VAT. No mapping is inferred for other exemptions or zero-rate cases. */
export function facturxModel(d: FacturxDocument) {
  // Credit-note snapshots retain this exact generated mention but not vat_regime.
  const franchiseBase = d.exemptionMention === FRANCHISE_BASE_MENTION
    && (d.vatRegime === "franchise_base" || d.vatRegime == null);
  if (franchiseBase) {
    if (countryCode(d.seller.country) !== "FR" || d.vatRate !== 0 || d.vatAmount !== 0 || d.excludingTax !== d.includingTax) throw new UnsupportedDocument("inconsistent_franchise_base_snapshot");
  } else if (d.vatRegime === "franchise_base" || d.exemptionMention || !(d.vatRate > 0 && d.vatRate <= 1) || !d.seller.vatNumber?.trim()) {
    throw new UnsupportedDocument("unsupported_tax_regime_or_missing_seller_vat");
  }
  if (d.currency !== "EUR") throw new UnsupportedDocument("unsupported_currency");
  if (![d.excludingTax, d.vatAmount, d.includingTax].every(n => Number.isSafeInteger(n) && n >= 0)
    || d.excludingTax + d.vatAmount !== d.includingTax
    || Math.abs(Math.round(d.excludingTax * d.vatRate) - d.vatAmount) > 1) throw new UnsupportedDocument("inconsistent_snapshot_totals");
  if (!d.number?.trim() || !d.title?.trim()) throw new UnsupportedDocument("missing_document_identity");
  if (d.kind === "credit_note" && !d.originalInvoiceNumber?.trim()) throw new UnsupportedDocument("missing_original_invoice_reference");
  const period = d.servicePeriod;
  if (period) {
    const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
    if (!validDate(period.start) || !validDate(period.end) || period.end < period.start) throw new UnsupportedDocument("invalid_service_period");
  }
  if ((!d.serviceDate && !(period && d.serviceRecipientName?.trim())) || (d.serviceDate && !Number.isFinite(Date.parse(d.serviceDate)))) throw new UnsupportedDocument("missing_service_date_for_strict_schematron");
  const date = new Date(d.issuedAt);
  if (!Number.isFinite(date.getTime())) throw new UnsupportedDocument("invalid_issue_date");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const issueDate = ["year", "month", "day"].map(type => parts.find(p => p.type === type)!.value).join("");
  const serviceParts = d.serviceDate ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(d.serviceDate)) : null;
  const serviceDate = serviceParts ? ["year", "month", "day"].map(type => serviceParts.find(p => p.type === type)!.value).join("") : null;
  const tax = { typeCode: value("VAT"), categoryCode: value(franchiseBase ? "E" : "S"), rateApplicablePercent: value(Number((d.vatRate * 100).toFixed(4))) };
  return {
    exchangedDocumentContext: { guidelineSpecifiedDocumentContextParameter: { id: value("urn:cen.eu:en16931:2017") } },
    exchangedDocument: { id: value(d.number), typeCode: value(d.kind === "credit_note" ? "381" : "380"), issueDateTime: { dateTimeString: issueDate, format: "102" } },
    supplyChainTradeTransaction: {
      includedSupplyChainTradeLineItem: [{
        associatedDocumentLineDocument: { lineID: value("1") },
        specifiedTradeProduct: { name: value(d.title) },
        specifiedLineTradeAgreement: { netPriceProductTradePrice: { chargeAmount: value(d.excludingTax / 100) } },
        specifiedLineTradeDelivery: { billedQuantity: { value: 1, unitCode: "C62" } },
        specifiedLineTradeSettlement: { applicableTradeTax: [tax], specifiedTradeSettlementLineMonetarySummation: { lineTotalAmount: value(d.excludingTax / 100) } },
      }],
      applicableHeaderTradeAgreement: { sellerTradeParty: party(d.seller, true, franchiseBase), buyerTradeParty: party(d.buyer, false) },
      applicableHeaderTradeDelivery: {
        ...(d.serviceRecipientName?.trim() ? { shipToTradeParty: { name: value(d.serviceRecipientName) } } : {}),
        ...(serviceDate ? { actualDeliverySupplyChainEvent: { occurrenceDateTime: { dateTimeString: serviceDate, format: "102" } } } : {}),
      },
      applicableHeaderTradeSettlement: {
        invoiceCurrencyCode: value(d.currency),
        ...(period ? { billingSpecifiedPeriod: {
          startDateTime: { dateTimeString: period.start.replaceAll("-", ""), format: "102" },
          endDateTime: { dateTimeString: period.end.replaceAll("-", ""), format: "102" },
        } } : {}),
        applicableTradeTax: [{ ...tax, calculatedAmount: value(d.vatAmount / 100), basisAmount: value(d.excludingTax / 100),
          ...(franchiseBase ? { exemptionReason: value(FRANCHISE_BASE_MENTION), exemptionReasonCode: value("VATEX-FR-FRANCHISE") } : {}),
        }],
        ...(!d.settled ? { specifiedTradePaymentTerms: [{ description: value("Avoir correspondant au remboursement enregistré") }] } : {}),
        ...(d.kind === "credit_note" ? { invoiceReferencedDocument: [{ issuerAssignedID: value(d.originalInvoiceNumber!) }] } : {}),
        specifiedTradeSettlementHeaderMonetarySummation: {
          lineTotalAmount: value(d.excludingTax / 100), taxBasisTotalAmount: value(d.excludingTax / 100),
          taxTotalAmount: [{ value: d.vatAmount / 100, currencyID: d.currency }], grandTotalAmount: value(d.includingTax / 100),
          totalPrepaidAmount: value(d.settled ? d.includingTax / 100 : 0), duePayableAmount: value(d.settled ? 0 : d.includingTax / 100),
        },
      },
    },
  };
}

export type FacturxResult = { pdf: Buffer; status: "embedded" | "unsupported" | "failed"; reason?: string };

/** Transactional enrichment: only return the new bytes after both XML checks
 * and extraction succeed. The original PDF is returned byte-for-byte on failure.
 * PDF/A conformance is verified on rendered fixtures with veraPDF, not claimed
 * here on the strength of XMP metadata alone. */
export async function enrichFacturx(pdf: Buffer, document: FacturxDocument): Promise<FacturxResult> {
  try {
    const model = facturxModel(document);
    const [{ invoiceToXml, check, generate, extract }, { PDFDocument, PDFName, PDFString }] = await Promise.all([
      import("@stafyniaksacha/facturx"), import("pdf-lib"),
    ]);
    const xmlDoc = await invoiceToXml(model as Parameters<typeof invoiceToXml>[0]);
    let xml: string;
    try { xml = xmlDoc.toString(); } finally { xmlDoc.dispose(); }
    const validation = await check({ xml, level: "en16931", schematron: true });
    if (!validation.valid || validation.schematronValid !== true) throw new Error("xml_validation_failed");
    // v0.6.1 interpolates metadata into XMP without XML escaping. Escape its
    // inputs, then restore the raw PDF Info values so Info and XMP agree.
    const escapeXml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
    const title = `${document.kind === "invoice" ? "Facture" : "Avoir"} ${document.number}`;
    const embedded = await generate({ pdf, xml, level: "en16931", check: true, language: "fr-FR", meta: {
      author: escapeXml(document.seller.name), title: escapeXml(title), subject: "Factur-X EN16931", keywords: ["Factur-X"], date: new Date(document.issuedAt),
    } });
    const result = await PDFDocument.load(embedded, { updateMetadata: false });
    result.setAuthor(document.seller.name);
    result.setTitle(title);
    const icc = await readFile(path.join(process.cwd(), "lib/facturx-assets/sRGB-v2-micro.icc"));
    const iccRef = result.context.register(result.context.flateStream(icc, { N: 3 }));
    const intent = result.context.register(result.context.obj({ Type: PDFName.of("OutputIntent"), S: PDFName.of("GTS_PDFA1"), OutputConditionIdentifier: PDFString.of("sRGB"), Info: PDFString.of("sRGB IEC61966-2.1"), DestOutputProfile: iccRef }));
    result.catalog.set(PDFName.of("OutputIntents"), result.context.obj([intent]));
    const finalPdf = Buffer.from(await result.save());
    const extracted = await extract({ pdf: finalPdf });
    // v0.6.1 may leave extract().level undefined; validate the XML profile below.
    if (extracted.filename !== "factur-x.xml" || extracted.xml.trim() !== xml.trim()) throw new Error("attachment_verification_failed");
    const rechecked = await check({ xml: extracted.xml, level: "en16931", schematron: true });
    if (!rechecked.valid || rechecked.level !== "en16931" || rechecked.schematronValid !== true) throw new Error("extracted_xml_validation_failed");
    return { pdf: finalPdf, status: "embedded" };
  } catch (error) {
    return { pdf, status: error instanceof UnsupportedDocument ? "unsupported" : "failed", reason: error instanceof UnsupportedDocument ? error.message : "facturx_generation_or_validation_failed" };
  }
}

export async function withFacturx(pdf: Buffer, document: FacturxDocument): Promise<Buffer> {
  const result = await enrichFacturx(pdf, document);
  // Do not log party data or raw XML. No metadata is written to the database.
  if (result.status !== "embedded") console.warn("[FACTURX_CLASSIC_PDF]", { status: result.status, reason: result.reason });
  return result.pdf;
}
