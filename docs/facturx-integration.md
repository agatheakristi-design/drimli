# Intégration locale Factur-X — 15 octobre 2026

Worktree : `fix/google-reviews-dashboard`, HEAD `8319bc3`, contenant `29d813a`.
Preuve de concept existante consultée dans `/private/tmp/drimli-facturx-poc/`, sans la reconstruire.

## Implémentation

Créés : `lib/facturx.ts`, `lib/facturx.test.mjs`, `lib/facturx-assets/sRGB-v2-micro.icc`,
`lib/facturx-assets/LICENSE`, `lib/facturx-assets/README.md`, ce compte rendu.

Modifiés : `app/api/stripe/webhook/route.ts`, `lib/billingDocuments.ts`,
`lib/drimliCommissionBilling.ts`, `next.config.ts`, `package.json`, `package-lock.json`.

Dépendances directes verrouillées : `@stafyniaksacha/facturx@0.6.1`, `pdf-lib@1.17.1`.
Profil sRGB CC0 embarqué (456 octets), sans chemin macOS ni téléchargement à la génération.

L'enrichissement intervient après le rendu existant, avant stockage et hash. Le XML reprend
les montants en centimes, les identités, le numéro et les dates des données historisées.
Aucune donnée fiscale ni identité manquante n'est inventée. Les avoirs utilisent le type 381
et la référence de la facture d'origine. Le profil est `urn:cen.eu:en16931:2017`.

Le XML est validé XSD et Schematron avant intégration, puis extrait du PDF final et revalidé.
Le nom de pièce jointe est contrôlé (`factur-x.xml`). La bibliothèque 0.6.1 ne renseignant pas
toujours `extract().level`, le profil est vérifié par la validation du XML extrait.
Les métadonnées XMP sont échappées pour les caractères spéciaux, sans changer le PDF visible.

En cas de données insuffisantes ou d'échec, le PDF classique original est conservé octet pour
octet. Aucun résultat partiel n'est archivé. Un journal `FACTURX_CLASSIC_PDF` indique le statut
et un motif technique sans données personnelles. Aucun statut de conformité n'est ajouté
à la base. Les documents déjà archivés ne sont pas régénérés.

## Couverture et limites

| Catégorie | État |
| --- | --- |
| Factures B2B | Opérationnel sous conditions : TVA standard positive, numéro de TVA vendeur, EUR, adresses/pays et date de prestation exploitables. |
| Factures B2C | Générateur validé si le pays du client est déjà historisé. Non opérationnel pour les nouvelles données sans pays ; aucun pays déduit. |
| Commissions DRIMLI | Non opérationnel en Factur-X ; PDF classique préservé. Point d'intégration présent, identité DRIMLI issue de son propre snapshot. |
| Avoirs clients | Opérationnel sous les mêmes conditions, avec référence d'origine. |
| Avoirs DRIMLI | Non opérationnel en Factur-X ; PDF classique préservé. |

La franchise en base et les autres exonérations restent explicitement non prises en charge.
Le numéro fictif FC de la preuve de concept n'est jamais utilisé. Une décision fiscale sur
les catégories d'exonération et les identifiants réels serait nécessaire pour élargir ce cas.

Le pays acheteur est requis par EN16931. Le flux B2C courant peut ne pas le renseigner.
La collecte de cette donnée n'a pas été ajoutée, conformément au périmètre demandé.
Pays acceptés : codes FR, BE, DE, ES, IT, LU, NL, PT, IE, AT, CH, GB, US, CA ; « France »
est aussi normalisé en FR. Les autres valeurs restent hors prise en charge.

Les snapshots des commissions contiennent un mois, pas une date précise de prestation.
L'élément de livraison vide est accepté par XSD mais déclenche PEPPOL-EN16931-R008,
un avertissement que cette bibliothèque considère comme un échec Schematron.
L'intégration stricte refuse ce cas ; aucune date n'est déduite du mois ou de l'émission.
Ce n'est pas une affirmation que toute commission exige réglementairement une date précise.

La validation veraPDF est exécutée sur les documents de test locaux, pas à chaque requête
Vercel. Les résultats PDF/A ci-dessous portent sur ces fixtures et leurs polices locales.
Aucune validation en environnement Vercel déployé n'a été effectuée.

## Vérifications

- 42 tests existants de facturation/B2B : PASS, sans paiement Stripe réel ni nouveau parcours Stripe.
- 7 tests Factur-X ciblés : PASS ; rendu réel Chromium, génération, extraction, XML extrait,
  TVA/montants/identités/numéros, avoir 381, référence d'origine, retour exact au PDF classique,
  document invalide, profil ICC absent, archivage simulé, hash final, non-régénération et téléchargement.
- Les trois fixtures enrichies B2B, B2C avec pays et avoir client passent XSD et Schematron,
  puis veraPDF 1.30.3 en PDF/A-3b, y compris avec `&` et `<` dans le nom du vendeur.
- Rendu final inspecté visuellement. Comparaison des PNG PDFKit à 144 dpi : empreintes identiques
  avant/après enrichissement pour les trois fixtures. Les modèles HTML restent inchangés.
- TypeScript sans émission, lint ciblé et `git diff --check` : PASS.
- Build Next.js webpack : PASS avec plafond mémoire 4 Go et variables fictives de build,
  dont `https://build.invalid`. Aucun fichier d'environnement créé ou modifié.
  Sans variables, la collecte des pages échoue ; le plafond initial 2 Go a aussi été insuffisant.
- Traces Next.js : présence du profil ICC, du package Factur-X, des XSD/Schematron EN16931,
  de Saxon et de `libxml2raw.mjs` pour webhook, remboursements et facturation des commissions.

Résultats détaillés de l’exécution documentée et PDF de test :
`/private/var/folders/r9/hbpd84s10311vhpkvqkd5_fh0000gn/T/drimli-facturx-tests-4EZNF4/`.
Rapports veraPDF : `b2b-verapdf.xml`, `b2c-verapdf.xml`, `credit-note-verapdf.xml`.
Log de la suite finale (49 tests, 49 PASS, veraPDF activé) : `/private/tmp/drimli-facturx-final-tests.log`.
Log du build avec configuration fictive : `/private/tmp/drimli-facturx-build.log`.

Commandes de tests (Node 24 utilisé localement) :

```bash
node --test lib/billing.test.mjs lib/billingWorkflow.test.mjs lib/bookingCustomer.test.mjs
VERAPDF=/private/tmp/drimli-facturx-poc/verapdf/verapdf node --test lib/facturx.test.mjs
npx tsc --noEmit --incremental false
npx eslint lib/facturx.ts lib/billingDocuments.ts lib/drimliCommissionBilling.ts next.config.ts
```

Sans `VERAPDF`, les tests annoncent explicitement que PDF/A n'a pas été vérifié.
Le chemin du validateur ne concerne que les tests, jamais la génération de production.
Les téléchargements et écritures d'archivage ont été testés avec Supabase simulé.
Aucun téléchargement authentifié de production, test Stripe réel ou déploiement n'a été exécuté.

## État Git et préservation

Les seuls éléments préexistants non suivis étaient `supabase/.temp/cli-latest` et
`supabase/.temp/linked-project.json`. Ils sont préservés ; aucun fichier de migration modifié.
La branche `main` reste à `640e04c` et son worktree reste propre.
Aucun commit, push, merge, rebase, reset, changement de branche ou déploiement effectué.
Aucune donnée de production, configuration Stripe ou variable d'environnement de production modifiée.

## Limite de l'environnement de dépendances local

Une commande npm sans écriture de lockfile a recalculé l'arbre local `node_modules`.
La réinstallation complète proposée ensuite a été refusée et n'a pas été relancée.
Le lockfile final préserve toutes les versions préexistantes : `hasown@2.0.4`, requis
par le nouveau `form-data`, est isolé sous ce dernier ; la version racine 2.0.2 reste inchangée.
Une installation propre finale n'est donc pas validée et l'arbre installé peut différer du lockfile.
L'analyse en lecture seule du graphe verrouillé ne révèle aucune dépendance invalide ajoutée.
Elle retrouve une incohérence optionnelle WASI/Tailwind déjà présente dans HEAD, laissée intacte.

Stripe 20.1.2 et Playwright Core 1.62.0 ont ensuite été restaurés de manière ciblée depuis
les copies locales existantes, sans npm ni téléchargement, avec autorisation. Aucun fichier
source de paiement modifié. TypeScript et lint repassent après cette restauration.

Les 49 tests finaux passent à nouveau après restauration, avec le Chromium 1234 déjà
disponible et veraPDF activé. Aucun navigateur téléchargé.
Pour reproduire dans cet environnement local, définir cette variable vers l'exécutable existant :
`/Users/Florence/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`.
Ce chemin ne figure pas dans le code de génération ; il concerne uniquement l'exécution des tests locaux.
