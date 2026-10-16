# Pays B2C et vérification des commissions — 16 octobre 2026

Worktree `fix/google-reviews-dashboard`, modifications précédentes conservées.

## Pays B2C : réalisé

Le formulaire de réservation des particuliers propose « Pays », France sélectionnée par défaut.
Les 249 codes ISO 3166-1 alpha-2 sont proposés avec leur nom français. Le sélecteur est masqué
en B2B ; son choix ne remplace jamais le pays déclaré de l'entreprise.

Le formulaire transmet `clientCountry`. Le serveur valide le code, puis enregistre uniquement
`{ customerType: "individual", country: "FR" }` (ou le code choisi) dans le JSON existant
`appointments.customer_billing`. Au checkout, ce cas est distingué du B2B et le pays est copié
dans `billing_checkout_snapshots.customer_country`. La copie vers `client_invoices` existait
déjà. Aucun identifiant d'entreprise ou de TVA n'est ajouté à un particulier.

La liste ISO et sa validation sont partagées entre formulaire, API et module Factur-X.
Cela supprime la précédente restriction Factur-X à une courte liste de pays. Les valeurs
historiques « France » côté émetteur restent reconnues par l'adaptateur.

Les anciens clients API qui omettent ce nouveau champ gardent leur comportement précédent :
aucun pays n'est déduit ou écrit pour eux. Une ancienne réservation sans pays et les anciennes
factures ne sont pas complétées rétroactivement. Les documents archivés ne sont pas régénérés.
Un code explicitement invalide est refusé avant paiement. Le parcours B2B et la recherche
dans le registre des entreprises n'ont pas été modifiés.

## Commissions : règle conforme, calculs inchangés

`calculateDrimliFee(10000)` renvoie déjà 500 centimes : commission de 5 % TTC.
`drimliVatBreakdown(500)` donne déjà 417 centimes HT, 83 centimes de TVA, 500 centimes TTC.
Le calcul SQL de clôture mensuelle applique lui aussi HT = arrondi(TTC × 5/6), puis TVA = TTC − HT.
Le montant professionnel reste 9500 centimes. Les frais Stripe ne sont pas ajoutés à la facture
du professionnel et ne sont pas déduits une seconde fois de ces 95 € par cette logique.

Aucune formule, taux, numérotation, clôture, paiement ou remboursement n'a changé.
Seul le commentaire du checkout a été précisé. Le bloc de création de session Stripe a été
comparé à la sauvegarde avant intervention : il est identique octet pour octet.

La facture PDF réelle du test de commission affiche 4,17 € HT, 0,83 € de TVA et 5,00 € TTC,
émis par LEWIS PARKER — DRIMLI pour le professionnel. Son texte et son rendu ont été contrôlés.
Le modèle XML de diagnostic reprend exactement ces mêmes montants, sans recalculer le snapshot.

## Période mensuelle : blocage technique confirmé

La période `period_month` est disponible. Un candidat XML de diagnostic utilise la période
du 1er au 31 octobre 2026 en BG-14, sans `ActualDeliverySupplyChainEvent` et sans transformer
une date d'encaissement en date de prestation.

Résultat réel avec la bibliothèque 0.6.1 :

- XSD : aucune erreur.
- Montants HT/TVA/TTC : cohérents, aucune erreur de calcul signalée.
- Schematron : avertissement `PEPPOL-EN16931-R008` sur `ApplicableHeaderTradeDelivery` vide.
- Résultat global `check().valid` : false.

Ce bloc est obligatoire dans le XSD CII utilisé ; sans date ou partie de livraison déclarée,
il reste vide. La période de facturation se trouve dans le règlement et ne remplit pas ce bloc.
La date BT-72 n'est pas une obligation générale sur toutes les factures EN16931 : ici, c'est
l'interaction du schéma et du traitement des avertissements par le validateur qui bloque.

Le candidat n'est ni intégré à un PDF ni archivé comme Factur-X. Le module ne contourne pas
l'échec, ne remplace pas la date de prestation par un encaissement et conserve le PDF classique.
Commissions et avoirs DRIMLI restent donc non opérationnels en Factur-X strict.

La prochaine correction doit porter sur cette compatibilité schéma/Schematron pour une
facture périodique sans livraison datée, en conservant les montants et la période existants.
Elle ne doit pas consister à fabriquer une date ou un destinataire de livraison, ni à ignorer
silencieusement un résultat de validation négatif. Aucune migration nécessaire à la collecte B2C.

Référence sémantique pour les périodes :
[EN16931 — période de facturation, OpenPeppol](https://docs.peppol.eu/poacc/billing/3.0/syntax/ubl-invoice/cac-InvoicePeriod/).

## Fichiers de cette intervention

Créés : `lib/billingCountries.mjs`, ce compte rendu.

Modifiés :

- `app/reserver/[serviceId]/page.tsx` : sélecteur B2C, valeur FR par défaut, transmission.
- `app/api/appointments/create/route.ts` : validation et stockage dans le JSON existant.
- `app/api/stripe/checkout/route.ts` : lecture du pays individuel et copie dans le snapshot ; commentaire précisé.
- `lib/bookingCustomer.ts` : export de la validation de pays, sans changement de validation B2B.
- `lib/facturx.ts` : validation ISO partagée à la place de la liste restreinte.
- `lib/bookingCustomer.test.mjs` : quatre tests ajoutés (FR, BE, AU, refus et isolation B2B).
- `lib/facturx.test.mjs` : trois tests ajoutés (XML B2C AU, calcul/période des commissions, sélecteur réel).

Les 53 tests préexistants ont été conservés octet pour octet ; seule leur suite a été prolongée.
Aucune dépendance ajoutée ou réinstallée, aucune configuration de production changée.

## Résultats des tests

60 tests réussis, 0 échec, 0 ignoré. Réservations et checkout sont testés avec services simulés.
Le contrôle du sélecteur extrait du formulaire réel vérifie France par défaut et la sélection
d'Australie dans Chromium. FR, BE et AU sont vérifiés de la réservation au snapshot.
Un document B2C AU est ensuite produit par le vrai parcours de génération PDF et contrôlé.

Les six fixtures effectivement enrichies (factures B2B/B2C, avoir client, deux documents 293 B,
B2C AU) passent XSD, Schematron, extraction et revalidation, puis veraPDF 1.30.3 en PDF/A-3b.
Le rendu PNG 144 dpi du nouveau PDF B2C est identique au PDF classique avant enrichissement.
Les PDF B2C et commission classique ont été inspectés visuellement ; les montants de commission
ont aussi été extraits avec PDFKit et vérifiés. Le PDF classique de commission n'est pas déclaré
Factur-X ni PDF/A-3b. L'échec Schematron du candidat périodique est vérifié comme un blocage attendu,
pas comme une validation Factur-X réussie.

TypeScript, lint ciblé des modules/API et `git diff --check` : PASS.
Aucune nouvelle compilation générale, aucun test Stripe réel ni validation sur Vercel déployé.
veraPDF est utilisé dans les tests locaux, pas ajouté au runtime de production.

Rapports et fixtures :
`/private/var/folders/r9/hbpd84s10311vhpkvqkd5_fh0000gn/T/drimli-facturx-tests-3QQ1MW/`.
Log : `/private/tmp/drimli-last-points/tests.log`.
Diagnostic commission : `commission-period-candidate.xml`, `commission-period-validation.json`.

## Préservation

`main` est inchangé et propre. Les migrations, le registre des entreprises, les fichiers de
`supabase/.temp/`, les anciennes factures et toutes les modifications locales précédentes sont
préservés. Aucun commit, push, déploiement, changement des flux Stripe Connect ou modification
de données de production.
