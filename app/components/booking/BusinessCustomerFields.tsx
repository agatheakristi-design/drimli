"use client";

import { useEffect, useState } from "react";
import Button from "@/app/components/ui/Button";
import { emptyBusinessCustomer, validateBusinessCustomer, type BusinessCustomer } from "@/lib/bookingCustomer";
import { searchCompanies, type CompanyResult } from "@/lib/companySearch";
import styles from "@/app/reserver/[serviceId]/page.module.css";

export default function BusinessCustomerFields({ value, onChange }: {
  value: BusinessCustomer | null;
  onChange: (value: BusinessCustomer | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [establishmentPage, setEstablishmentPage] = useState(1);
  const [results, setResults] = useState<{ companies: CompanyResult[]; hasMore: boolean }>({ companies: [], hasMore: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const enabled = value !== null;

  useEffect(() => {
    if (!enabled || editing || query.trim().length < 3) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const found = await searchCompanies(query, page, establishmentPage, controller.signal);
        if (!controller.signal.aborted) setResults(found);
      } catch {
        if (!controller.signal.aborted) setError("Recherche indisponible. Vous pouvez saisir les coordonnées manuellement.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 400);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [enabled, editing, query, page, establishmentPage]);

  function search(next: string, nextPage = 1, nextEstablishmentPage = 1) {
    setQuery(next); setPage(nextPage); setEstablishmentPage(nextEstablishmentPage);
    setResults({ companies: [], hasMore: false }); setError(""); setLoading(next.trim().length >= 3);
  }
  function edit(key: keyof Omit<BusinessCustomer, "confirmed">, text: string) {
    if (value) onChange({ ...value, [key]: text, confirmed: false });
    setError("");
  }
  function confirm() {
    const checked = validateBusinessCustomer({ ...value, confirmed: true });
    if (checked.error) setError(checked.error);
    else { onChange(checked.data); setError(""); }
  }

  return <div className={styles.field}>
    <label><input type="checkbox" checked={enabled} onChange={(event) => {
      onChange(event.target.checked ? { ...emptyBusinessCustomer } : null);
      setEditing(false); search("");
    }} /> Je réserve en tant que professionnel</label>
    {value ? <>
      {!editing ? <>
        <label htmlFor="company-search">Rechercher mon entreprise (nom ou SIRET)</label>
        <input id="company-search" className="input" value={query} maxLength={200} onChange={(event) => search(event.target.value)} />
        {loading ? <p role="status">Recherche en cours…</p> : null}
        {!loading && !error && query.trim().length >= 3 && results.companies.length === 0 ? <p>Aucun résultat. Essayez un SIRET ou la saisie manuelle.</p> : null}
        {results.companies.map((company) => <div key={company.siren}>
          <p><strong>{company.name}</strong> — SIREN {company.siren}</p>
          {company.establishments.map((establishment) => <p key={establishment.siret}>
            <Button variant="secondary" type="button" onClick={() => { onChange(establishment); setEditing(true); setError(""); }}>
              {establishment.siret} — {establishment.address}, {establishment.postalCode} {establishment.city}
            </Button>
          </p>)}
          {company.establishmentCount > 1 ? <Button variant="secondary" type="button" onClick={() => search(company.siren, 1, query === company.siren ? establishmentPage + 1 : 1)}>Voir les autres établissements</Button> : null}
        </div>)}
        {page > 1 ? <Button variant="secondary" type="button" onClick={() => search(query, page - 1)}>Résultats précédents</Button> : null}
        {results.hasMore ? <Button variant="secondary" type="button" onClick={() => search(query, page + 1)}>Résultats suivants</Button> : null}
        {establishmentPage > 1 ? <Button variant="secondary" type="button" onClick={() => search(query, 1, establishmentPage - 1)}>Établissements précédents</Button> : null}
        <Button variant="secondary" type="button" onClick={() => { setEditing(true); setError(""); }}>Je ne trouve pas mon entreprise</Button>
      </> : <>
        {([
          ["businessName", "Raison sociale"], ["siren", "SIREN (si applicable)"], ["siret", "SIRET de l’établissement (si applicable)"],
          ["address", "Adresse de facturation"], ["postalCode", "Code postal"], ["city", "Ville"],
          ["country", "Pays (code à deux lettres, ex. FR, BE, GB)"], ["vatNumber", "Numéro de TVA (si applicable)"],
        ] as const).map(([key, label]) => <div className={styles.field} key={key}>
          <label htmlFor={`billing-${key}`}>{label}</label>
          <input id={`billing-${key}`} className="input" value={value[key]} maxLength={key === "address" ? 500 : key === "country" ? 2 : 200} onChange={(event) => edit(key, event.target.value)} />
        </div>)}
        {value.confirmed ? <p role="status">Informations de facturation confirmées.</p> : <Button variant="secondary" type="button" onClick={confirm}>Confirmer ces informations</Button>}
        <Button variant="secondary" type="button" onClick={() => { onChange({ ...emptyBusinessCustomer }); setEditing(false); search(""); }}>Rechercher une autre entreprise</Button>
      </>}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </> : null}
  </div>;
}
