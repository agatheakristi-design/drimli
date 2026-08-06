import { randomBytes } from "node:crypto";

export function generateAppointmentJoinToken() {
  return randomBytes(32).toString("base64url");
}

export function buildAppointmentPortalUrl(joinToken: string) {
  const token = joinToken.trim();
  if (!token) throw new Error("Appointment join token is required.");

  const configuredBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);

  if (!configuredBaseUrl) {
    throw new Error("Public application URL is not configured.");
  }

  const baseUrl = new URL(configuredBaseUrl);
  const localDevelopment =
    baseUrl.protocol === "http:" && baseUrl.hostname === "localhost";

  if (baseUrl.protocol !== "https:" && !localDevelopment) {
    throw new Error("Public application URL must use HTTPS.");
  }

  return new URL(
    `/rendez-vous/${encodeURIComponent(token)}`,
    baseUrl
  ).toString();
}
