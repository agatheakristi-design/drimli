// Accept only scope identifiers, never arbitrary OAuth response fields.
export function googleScopeDiagnostic(scope: unknown) {
  const scopePresent = typeof scope === "string" && scope.trim().length > 0;
  const scopes = scopePresent
    ? [...new Set(scope.trim().split(/\s+/).filter((name) =>
        /^(?:openid|email|profile|https:\/\/www\.googleapis\.com\/auth\/[a-zA-Z0-9._/-]+)$/.test(name)
      ))]
    : [];
  return { scopePresent, scopes };
}

export function googleConnectionError(search: string): string {
  return new URLSearchParams(search).get("google") === "error"
    ? "La connexion à Google Meet n'a pas pu être finalisée. Réessayez."
    : "";
}
