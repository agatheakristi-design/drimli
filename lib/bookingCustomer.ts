import { parsePhoneNumberFromString } from "libphonenumber-js/max";
export { normalizeBillingCountry } from "./billingCountries.mjs";

export function validateContact(emailValue: unknown, phoneValue: unknown) {
  const email = typeof emailValue === "string" ? emailValue.trim() : "";
  const phone = typeof phoneValue === "string" ? phoneValue.trim() : "";
  const errors: { email?: string; phone?: string } = {};
  const [local = "", domain = "", extra] = email.split("@");
  const labels = domain.split(".");
  if (!email) errors.email = "Indiquez votre adresse e-mail.";
  else if (email.length > 254 || local.length > 64 || !local || extra !== undefined ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..") ||
    labels.length < 2 || labels.some((label) => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)) ||
    !/^(?:[A-Za-z]{2,}|xn--[A-Za-z0-9-]+)$/.test(labels.at(-1) ?? "")) {
    errors.email = "Indiquez une adresse e-mail valide, par exemple vous@exemple.fr.";
  }
  let normalizedPhone = phone;
  if (!phone) errors.phone = "Indiquez votre numéro de téléphone.";
  else {
    const input = phone.startsWith("00") ? `+${phone.slice(2)}` : phone;
    const parsed = input.length <= 50 && /^\+?[0-9 ()\.\-]+$/.test(input)
      ? parsePhoneNumberFromString(input, { defaultCountry: "FR", extract: false }) : undefined;
    if (!parsed?.isValid()) errors.phone = "Indiquez un numéro complet et valide. Pour l’étranger, ajoutez l’indicatif du pays (ex. +44).";
    else normalizedPhone = parsed.number;
  }
  return { email, phone: normalizedPhone, errors, valid: Object.keys(errors).length === 0 };
}

export type BusinessCustomer = {
  businessName: string; siren: string; siret: string; address: string;
  postalCode: string; city: string; country: string; vatNumber: string;
  confirmed: boolean;
};
export const emptyBusinessCustomer: BusinessCustomer = {
  businessName: "", siren: "", siret: "", address: "", postalCode: "", city: "", country: "FR", vatNumber: "", confirmed: false,
};

export function validateBusinessCustomer(value: unknown): { data: BusinessCustomer | null; error: string | null } {
  if (value == null) return { data: null, error: null };
  if (typeof value !== "object" || Array.isArray(value)) return { data: null, error: "Coordonnées de facturation invalides." };
  const input = value as Record<string, unknown>;
  const data = { ...emptyBusinessCustomer };
  for (const key of ["businessName", "siren", "siret", "address", "postalCode", "city", "country", "vatNumber"] as const) {
    if (typeof input[key] !== "string" || input[key].length > (key === "address" ? 500 : 200) || /[\u0000-\u001f<>]/.test(input[key])) {
      return { data: null, error: "Coordonnées de facturation invalides." };
    }
    data[key] = input[key].trim();
  }
  data.country = data.country.toUpperCase();
  data.siren = data.siren.replace(/\s/g, "");
  data.siret = data.siret.replace(/\s/g, "");
  if (!data.businessName || !data.address || !data.city || !/^[A-Z]{2}$/.test(data.country)) return { data: null, error: "Complétez la raison sociale, l’adresse, la ville et le pays (code à deux lettres)." };
  try { if (new Intl.DisplayNames(["fr"], { type: "region", fallback: "none" }).of(data.country) === undefined || ["ZZ", "EU", "UN"].includes(data.country)) throw new Error(); }
  catch { return { data: null, error: "Indiquez un pays valide (code à deux lettres)." }; }
  if (data.country === "FR" && (!/^\d{5}$/.test(data.postalCode) || (!data.siren && !data.siret))) return { data: null, error: "Indiquez le code postal et le SIREN ou SIRET de l’entreprise française." };
  if ((data.siren && !/^\d{9}$/.test(data.siren)) || (data.siret && !/^\d{14}$/.test(data.siret)) ||
    (data.siren && data.siret && !data.siret.startsWith(data.siren))) return { data: null, error: "Le SIREN doit contenir 9 chiffres et le SIRET 14 chiffres correspondant au même SIREN." };
  if (!data.siren && data.siret) data.siren = data.siret.slice(0, 9);
  if (input.confirmed !== true) return { data: null, error: "Confirmez les informations de facturation de votre entreprise." };
  data.confirmed = true;
  return { data, error: null };
}

export function businessSnapshot(data: BusinessCustomer | null) {
  return {
    customer_type: data ? "business" : "individual",
    customer_business_name: data?.businessName || null,
    customer_siren: data?.siren || null, customer_siret: data?.siret || null,
    customer_address: data?.address || null, customer_postal_code: data?.postalCode || null,
    customer_city: data?.city || null, customer_country: data?.country || null,
    customer_vat_number: data?.vatNumber || null,
  };
}
