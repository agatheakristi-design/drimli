# Commissions DRIMLI : déblocage Factur-X — 16 octobre 2026

Cette note remplace la limitation des commissions décrite dans les comptes rendus précédents.
Intervention limitée au XML des factures de commissions, dans `fix/google-reviews-dashboard`.

## Solution intégrée

La période seule n'alimente pas le bloc CII de livraison. En revanche, ce bloc accepte le nom
du destinataire du service en BT-70 : le professionnel auquel DRIMLI fournit le service de plateforme.
Ce rôle est celui du professionnel facturé dans le modèle DRIMLI, pas celui du client de son rendez-vous.

Le mapping utilise uniquement les données historisées :

- BT-70, `ApplicableHeaderTradeDelivery/ShipToTradeParty/Name` : raison sociale ou nom complet
  du professionnel dans `customer_snapshot`.
- BG-14, BT-73/BT-74, `ApplicableHeaderTradeSettlement/BillingSpecifiedPeriod` : début et fin
  du mois désigné par `period_month`, format 102. Février bissextile et décembre sont testés.
- BT-72, `ActualDeliverySupplyChainEvent` : absent, puisqu'aucune date ponctuelle n'est déclarée.

Le SIRET historisé est un critère de prise en charge pour s'assurer d'une identité professionnelle
documentée : chaîne de 14 chiffres non nulle, avec nom exploitable et mois valide. C'est un garde-fou
DRIMLI, pas une affirmation que le standard exige un SIRET en BT-70. Aucune vérification de registre
n'est ajoutée. Le SIRET n'est pas transformé en identifiant de lieu de livraison BT-71.
Le bloc de destinataire contient seulement le nom : aucune adresse ni localisation physique n'est déduite.
Le nom générique de repli « Professionnel » du PDF n'est pas créé comme donnée de destinataire.

Les limites calendaires décrivent la période réelle déjà définie par le mois facturé. Elles ne sont
jamais placées en date de livraison et ne sont pas déduites de la date d'émission, du paiement ou
de l'horloge courante. Le PDF conserve sa présentation et son libellé mensuel existants.

## Contraintes vérifiées

Le XSD EN16931 embarqué impose `ApplicableHeaderTradeDelivery` (1..1), mais ses enfants sont
optionnels : `ShipToTradeParty`, `ActualDeliverySupplyChainEvent`, références d'avis d'expédition
ou de réception. Le nom du destinataire suffit à rendre ce bloc non vide avec une donnée réelle.

Les tests démontrent que :

- période en règlement + destinataire nommé : XSD et Schematron entièrement valides ;
- suppression du bloc de livraison : échec XSD ;
- bloc de livraison vide : échec R008 ;
- déplacement de `BillingSpecifiedPeriod` dans le bloc de livraison : échec XSD.

Le prototype local utilisait une date réelle dans `ActualDeliverySupplyChainEvent`. Ce mécanisme
reste inchangé pour les factures de prestations. Les commissions utilisent ici une autre donnée
permise par le même bloc, sans inventer de date. Les contrôles existants `check().valid` et
`schematronValid` restent strictement exigés, avant intégration et après extraction.

## Périmètre et préservation

Fichiers modifiés dans cette intervention :

- `lib/facturx.ts` : prise en charge additive d'une période explicite et d'un destinataire explicite.
- `lib/drimliCommissionBilling.ts` : transmission de ces données pour les factures de commissions
  dont le snapshot contient l'identité exploitable ; aucun changement du modèle HTML ni des calculs.
- `lib/facturx.test.mjs` : quatre tests ajoutés à la suite existante, sans changer les 60 tests.

Créé : ce compte rendu. Aucun changement de dépendances ou de ressources du validateur.

Les montants sont repris tels quels : test de 5 € TTC = 4,17 € HT + 0,83 € de TVA. L'émetteur
reste LEWIS PARKER — DRIMLI ; le destinataire financier reste le professionnel. Le hash est calculé
sur le PDF enrichi final, les chemins et les options d'archivage sont conservés.
Un `file_path` déjà présent provoque toujours le retour immédiat : aucun document archivé réécrit.

Les snapshots incomplets, SIRET manquants/mal formés, périodes invalides ou validations en échec
conservent le PDF classique. Aucun champ n'est ajouté aux anciennes lignes ni complété depuis un profil actuel.
Le nom seul n'active jamais automatiquement le mapping pour tous les documents de l'adaptateur :
le destinataire et la période doivent être explicitement transmis par le parcours des commissions.

Les avoirs de commissions restent sur leur parcours précédent et son repli. Leur mapping de période
n'est pas ajouté dans cette mission limitée aux factures de commissions.

Formulaire, pays B2C, factures de prestations, calculs de commissions, montants, numérotation,
flux Stripe Connect, remboursements et migrations Supabase n'ont pas été modifiés.

## Tests exécutés

- 64 tests réussis, zéro échec, zéro ignoré ; les 60 existants sont conservés octet pour octet.
- Trois nouvelles factures de commissions réellement générées : octobre 2026, février 2028,
  décembre 2026, avec émission dans un mois différent.
- XML EN16931 : XSD et Schematron PASS, sans erreur ni avertissement R008.
- XML extrait du PDF final : nom `factur-x.xml`, profil, période, destinataire, montants vérifiés
  et validation XSD/Schematron répétée. Les deux validations restent aussi exécutées dans l'adaptateur.
- veraPDF 1.30.3 : PDF/A-3b PASS pour ces trois PDF ; les six fixtures antérieures passent également.
- PDFKit : montants extraits des trois PDF et comparés à 4,17 / 0,83 / 5,00 ; rendus 144 dpi
  identiques avant et après enrichissement. Contrôle visuel des pages effectué.
- Repli classique : identité mal formée (y compris type JSON numérique), identifiant nul,
  destinataire absent et période invalide testés ; aucun hybride partiel archivé.
- TypeScript, lint des deux modules modifiés et `git diff --check` : PASS.

Aucun nouveau test Stripe réel, build général, déploiement ou validation Vercel exécuté.
La validation PDF/A concerne les fixtures locales ; veraPDF n'est pas exécuté à chaque requête Vercel.

Résultats, PDF, XML, PNG et rapports veraPDF : `/var/folders/r9/hbpd84s10311vhpkvqkd5_fh0000gn/T/drimli-facturx-tests-VLAgwI`.
Log : `/private/tmp/drimli-commission-unblock/tests.log`.

## Références ciblées

- [EN16931 BT-70, nom du destinataire des biens ou services](https://docs.peppol.eu/poacc/billing/3.0/syntax/ubl-invoice/cac-Delivery/cac-DeliveryParty/cac-PartyName/).
- [EN16931 BG-14, période de facturation](https://docs.peppol.eu/poacc/billing/3.0/syntax/ubl-invoice/cac-InvoicePeriod/).
- [Règle R008, contexte des éléments vides](https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-peppol/PEPPOL-EN16931-R008/).

Ces références documentent les termes sémantiques également présents en UBL ; la position XML CII
a été vérifiée dans le XSD EN16931 embarqué avec la bibliothèque et par les validations exécutées.

`main`, les migrations et `supabase/.temp/` restent inchangés. Modifications locales précédentes
préservées. Aucun commit, push, déploiement ou changement de données de production.
