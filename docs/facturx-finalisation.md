# Finalisation ciblée Factur-X — 16 octobre 2026

Cette note actualise le compte rendu du 15 octobre, sans refaire son intégration.
Worktree : `fix/google-reviews-dashboard`, HEAD conservé à `8319bc3`.

## 1. Franchise en base : correction réalisée

Le refus précédent venait du garde-fou exigeant systématiquement un taux positif et un
numéro de TVA. Le prototype contournait BR-E-02 par un identifiant FC fictif ; il n'a pas été repris.

Le cas français de l'article 293 B est désormais identifié uniquement par la mention exacte
déjà produite par DRIMLI : « TVA non applicable, art. 293 B du CGI », avec `vat_regime`
`franchise_base` lorsqu'il est historisé. Les snapshots d'avoirs ne conservant pas ce champ,
leur déclaration exacte d'origine est utilisée. Une déclaration contradictoire est refusée.
Le vendeur doit être établi en France, le taux et la TVA doivent être nuls et HT = TTC.

Le XML utilise E, VATEX-FR-FRANCHISE et la mention fiscale conservée. Si le vendeur possède
déjà un numéro de TVA, il est repris en VA. Sinon, le SIREN est extrait des neuf premiers
chiffres du SIRET historisé et répété comme identifiant fiscal BT-32 en FC. Le SIREN est
aussi renseigné comme identifiant légal, schéma 0002. Format et contrôle du SIREN sont
vérifiés ; aucun numéro de TVA n'est calculé et aucun identifiant n'est inventé.

Ce mapping particulier correspond à BR-FR-CO-16 du texte AFNOR XP Z12-012. Il ne transforme
pas tous les professionnels en franchise en titulaires d'un identifiant fiscal FC arbitraire :
seul leur SIREN fourni est repris dans le cas national précisément identifié.
Les autres exonérations, les zéros sans motif, les déclarations contradictoires et les
identifiants insuffisants restent en PDF classique. L'absence de SIRET exploitable sans
numéro de TVA est journalisée par `franchise_base_missing_valid_siren_from_siret`.

Collecte nécessaire si ce cas manque : corriger le SIRET réellement attribué dans les
réglages de facturation existants du professionnel, avant la nouvelle transaction.
Ne pas réécrire les snapshots d'anciennes factures. Aucun nouveau champ ni migration requis.

## 2. Commissions : données identifiées, décision de date non imposée

`drimli_commission_movements.effective_at` conserve la date du mouvement ; pour une collecte,
`recordCollectedCommission` la reprend de `drimli_payments.paid_at`. Les mouvements de remboursement
ont également leur date effective. Ils sont rattachés à l'invoice par `invoice_id`.
La facture mensuelle possède aussi sa période fiable `period_month` et son `issued_at`.

Il existe donc des dates historisées. Mais une date de paiement ou de remboursement n'est
pas, à elle seule, une déclaration de date d'exécution de la prestation de commission.
La facture agrège plusieurs mouvements : choisir le premier, le dernier, la fin du mois
ou la date d'émission comme BT-72 changerait silencieusement cette signification.

BT-72 n'est pas systématiquement obligatoire en EN16931. Le blocage actuel vient du garde-fou
du module et de l'avertissement PEPPOL-EN16931-R008 déclenché par le bloc CII de livraison
vide, obligatoire dans le XSD utilisé. La bibliothèque considère cet avertissement comme
un `check().valid = false`. Aucun contrôle n'a été assoupli pour faire passer ce cas.

Proposition minimale : privilégier le mapping de la période mensuelle déjà historisée vers
la période de facturation BG-14 (BT-73/BT-74), sans inventer BT-72, puis résoudre la compatibilité
du bloc de livraison vide avec le validateur avant activation. Cela ne requiert pas de migration.
Si une date unique de prestation est souhaitée, faire confirmer sa convention métier/fiscale,
puis utiliser les mouvements déjà rattachés selon cette convention. Ne pas utiliser la date
de rendez-vous du client pour une prestation émise par DRIMLI.
Dans cette intervention, commissions et avoirs DRIMLI restent volontairement en PDF classique.

## 3. B2C : pays non collecté, proposition sans migration

Le code actuel du formulaire de réservation et de l'API collecte le pays via les coordonnées
professionnelles. Pour un particulier, `businessSnapshot(null)` produit `customer_country: null`.
Aucun nouveau champ de pays B2C n'a été trouvé dans ce parcours. Le pays ne doit pas être
déduit de la langue, du téléphone, de l'adresse IP ou du pays du professionnel.

Proposition minimale pour les nouvelles réservations uniquement :

1. Ajouter un choix explicite « Pays de facturation » pour le particulier, sans FR présélectionné.
2. Valider son code pays côté serveur et le conserver dans le JSON `appointments.customer_billing`
   existant, avec un discriminant de particulier pour ne pas le traiter comme une entreprise.
3. Adapter la lecture de ce JSON au checkout : conserver `customer_type = individual`, copier
   le pays dans `billing_checkout_snapshots.customer_country`, sans toucher aux paramètres Stripe.
4. Réutiliser la copie snapshot vers facture déjà existante ; aucun SIRET/numéro de TVA particulier.

Fichiers concernés par cette proposition : formulaire `app/reserver/[serviceId]/page.tsx`,
validation `lib/bookingCustomer.ts`, API de réservation et copie des coordonnées au checkout.
Ces changements de collecte ne sont pas implémentés dans cette intervention : la demande,
en l'absence de donnée, était de proposer la modification minimale. Aucune ancienne facture
ou réservation ne serait complétée automatiquement. Les colonnes/JSON existent dans le schéma
local décrit par les migrations ; aucune migration ne doit être appliquée par cette mission.

## Modifications et vérifications

Modifiés dans cette finalisation : `lib/facturx.ts`, `lib/billingDocuments.ts`,
`app/api/stripe/webhook/route.ts`, et ajout de quatre tests à la fin de `lib/facturx.test.mjs`.
Créé : ce compte rendu. Aucun fichier préexistant non concerné modifié, aucune dépendance ajoutée
ou réinstallée. Les modifications locales de la première intervention sont conservées.

- 53 tests réussis : les 49 précédents conservés octet pour octet, plus quatre tests ciblés 293 B.
- XSD, Schematron et extraction/revalidation XML : PASS pour les nouvelles factures et avoirs.
- veraPDF 1.30.3, PDF/A-3b : PASS sur les deux nouveaux documents enrichis et les trois fixtures existantes.
- PNG PDFKit 144 dpi des nouveaux documents : identiques avant/après enrichissement ; contrôle visuel effectué.
- TypeScript, lint ciblé, `git diff --check` : PASS.
- Données et montants des snapshots inchangés, hash du PDF final vérifié, avoir 381 avec référence d'origine.
- Repli conservé pour données manquantes/incohérentes, autres exonérations et commissions sans date déclarée.
- Aucun test Stripe réel, aucune validation Vercel déployée, aucune nouvelle compilation générale exécutée.

La validation PDF/A concerne les fixtures locales ; veraPDF n'est pas ajouté au runtime Vercel.
Le problème d'arbre `node_modules` potentiellement différent du lockfile, documenté la veille,
n'a pas été repris : aucune commande npm d'installation n'a été exécutée dans cette finalisation.

Résultats : `/var/folders/r9/hbpd84s10311vhpkvqkd5_fh0000gn/T/drimli-facturx-tests-mVf2AM`.
Log : `/private/tmp/drimli-facturx-finalisation/tests.log`.
Les XML/PDF et rapports veraPDF `franchise-invoice-*` et `franchise-credit-note-*` y sont conservés.

Sources ciblées :

- [EN16931 BR-E-02, OpenPeppol](https://docs.peppol.eu/poacc/billing/3.0/bis/) : identifiants vendeur requis en E.
- [AFNOR XP Z12-012, §4 et BR-FR-CO-16/17, texte reproduit](https://www.e-invoicing-france.eu/documentation/xp-z12-012/AFNOR-FE-XP-Z12-012-4-Formats-et-profils).
- [DGFiP : références des spécifications et normes applicables](https://www.impots.gouv.fr/specifications-externes-b2b).

`main` reste propre et inchangé ; `supabase/.temp/` est préservé. Aucun commit, push,
déploiement, changement Stripe Connect, migration ou modification de données de production.
