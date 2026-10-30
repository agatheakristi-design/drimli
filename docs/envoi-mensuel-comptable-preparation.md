# Envoi mensuel au comptable — développement local, non activé

La migration a été créée avec autorisation explicite. Elle n'a été appliquée que
sur PostgreSQL jetable dans /private/tmp pour les tests. Aucune intervention sur
Supabase DEV/Production, aucun véritable e-mail, aucune modification de vercel.json,
aucun commit/push/déploiement et aucune variable de production modifiée.

## Fonctionnement

- Deux points d'entrée envisagés le 5, à 06 et 07 UTC, sont filtrés par le créneau
  08:00–08:59 Europe/Paris : un seul est éligible selon été/hiver.
- queue_accountant_month réserve le mois civil précédent en heure de Paris.
  Les profils sans accountant_email non vide et sans facture/avoir sont exclus.
- Une seule ligne accountant_monthly_deliveries par professionnel/mois. L'adresse
  est relue avant la soumission à Resend ; aucun autre destinataire, aucune copie.
- buildClientDocumentArchive réutilise uniquement client_invoices et
  client_credit_notes : PDF inchangés, dossiers Factures/Avoirs, rapport des PDF
  manquants. Aucune utilisation de patient_invoices ni des commissions DRIMLI.
- Limites communes : 200 documents, 20 Mo de PDF sources, ZIP de 4 Mo. Une période
  vide n'envoie rien. Tous les PDF manquants ou un volume excessif bloquent le
  dossier avec un état explicite. Une absence partielle est signalée dans le ZIP
  et l'e-mail ; un incident technique Storage n'est pas classé comme PDF manquant.
- Le ZIP technique est stocké uniquement dans invoices après vérification que le
  bucket est privé. Chemin isolé par professionnel/dossier/tentative ; upsert=false
  empêche un ancien traitement de remplacer le fichier d'un autre traitement.

## Suivi et doublons

La nouvelle migration 20261025120000_accountant_monthly_deliveries.sql est additive.
monthly_statements et ses données historiques restent inchangés.

Le journal contient états, événements, tentatives, destinataire, verrou temporaire,
référence Resend, copie exacte de la requête d'e-mail et métadonnées d'archive.
RLS activée, aucun accès anon/authenticated ; accès uniquement par les API serveur
avec contrôles d'identité. Les fonctions de réservation/transition/renouvellement
sont réservées à service_role et utilisent des verrous de ligne.

- Lease de deux minutes ; les transitions exigent le bon jeton et une lease valide.
- Un succès n'est jamais repris. `sent` signifie accepté par Resend, pas la preuve
  que le message a été lu ou livré ; l'identifiant permet le contrôle dans Resend.
- Une erreur certaine de première soumission (4xx hors 409) permet une reprise
  contrôlée. Les erreurs réseau, délais et confirmations DB perdues restent
  `uncertain`, car Resend peut avoir accepté la requête.
- Dans ce dernier cas, reprise explicite avec EXACTEMENT la même requête et la même
  clé d'idempotence durant 23 heures à partir de la première soumission. La marge
  d'une heure reste sous la conservation Resend de 24 heures. Un échec de la
  relance ne transforme jamais cette incertitude antérieure en échec certain.
- Au-delà, pas de renvoi aveugle. L'action `reconcile` vérifie dans Resend l'ID,
  l'unique destinataire, l'expéditeur, l'objet et les corps exacts, puis marque le
  dossier accepté sans nouvel envoi. Sans preuve, le dossier reste en attente de
  vérification ; aucune fonction de « forçage » d'envoi n'est exposée.
- Maximum dix réservations par dossier. Les blocages/échecs ne sont pas repris
  automatiquement ; leur relance exige le secret serveur et un ID explicite.

## Liens et conservation

L'e-mail contient un jeton aléatoire de 256 bits vers l'application, valable sept
jours, et non une URL publique de bucket. Le hash est recherché côté serveur ;
aucun provider_id, chemin ou bucket de l'URL n'est utilisé. L'adresse comptable
actuelle est vérifiée à chaque accès. La redirection finale est signée au plus cinq minutes, bornées par les deux dates d’expiration absolues ; le JWT retourné par Storage est contrôlé avant transmission,
avec no-store et Referrer-Policy: no-referrer.

Après expiration, le comptable est invité à contacter le professionnel. Celui-ci
peut renouveler le lien dans Factures, « Liens du comptable ». L'API vérifie sa
session et son propriétaire ; la fonction SQL vérifie encore le propriétaire,
l'adresse comptable actuelle et la conservation de l'archive. Le hash est remplacé
pour invalider l'ancien lien applicatif. Aucun second e-mail mensuel n'est envoyé.
Un lien Storage déjà émis peut rester utilisable jusqu'à ses cinq minutes d'expiration.

La copie ZIP est accessible au maximum 30 jours. La purge technique, proposée
quotidiennement, réserve les lignes avant suppression et ne retire que les ZIP
du sous-dossier accountant-monthly de chaque dossier. Elle traite aussi les copies
de tentatives abandonnées. Les PDF sources et le journal historique restent
conservés. Une panne de nettoyage peut retarder la suppression physique ; le
contrôle applicatif interdit néanmoins le téléchargement après expiration.
Après purge, le professionnel peut toujours utiliser le ZIP manuel des PDF sources.

## Routes et activation séparée

Toutes les nouvelles routes restent inertes tant que ACCOUNTANT_MONTHLY_ENABLED
n'est pas exactement `true`. Aucune variable n'a été ajoutée à un environnement.

- GET /api/cron/accountant-monthly/summer : candidat 06 UTC.
- GET /api/cron/accountant-monthly/winter : candidat 07 UTC.
- GET /api/cron/accountant-monthly : même point d'entrée, utile pour contrôle.
- POST /api/cron/accountant-monthly : actions `continue`, `retry` (id obligatoire)
  ou `reconcile` (id du dossier et resendId obligatoires), avec CRON_SECRET.
- POST /api/cron/accountant-monthly/continue : acquitte immédiatement, puis lance
  un lot borné avec Next.js after(). Les dossiers restants déclenchent un nouvel
  appel interne authentifié et limité en temps. Les traitements verrouillés actifs
  ne déclenchent pas de boucle de continuations.
- GET /api/cron/accountant-monthly/cleanup : purge technique protégée par CRON_SECRET.
- GET /api/accountant-documents/download?token=... : lien du comptable.
- GET/POST /api/dashboard/client-documents/accountant-links : historique/renouvellement
  pour le professionnel authentifié seulement.

Candidats à ajouter SEULEMENT après validation (vercel.json n'est pas modifié) :

| Route | Expression UTC |
| --- | --- |
| /api/cron/accountant-monthly/summer | 0 6 5 * * |
| /api/cron/accountant-monthly/winter | 0 7 5 * * |
| /api/cron/accountant-monthly/cleanup | 45 4 * * * |

Le cron provider-payouts existant reste inchangé. Ces fréquences respectent la
restriction Hobby d'au plus un déclenchement quotidien par tâche. Sur Hobby, la
précision est horaire : envoi dans l'heure de 8 h à Paris, pas garantie de 08:00:00.
Le forfait réel et la configuration de protection du déploiement restent à vérifier.

Chaque fonction est bornée à 60 secondes. La préparation est annulée après 25 s,
le journal possède un budget indépendant de 50 s avec requêtes bornées à 5 s ;
Resend est considéré incertain après 10 s. Un lot traite au plus un dossier,
puis les continuations répartissent la charge. Si une continuation échoue, un log
ACCOUNTANT_MONTHLY_CONTINUATION_FAILED est émis et la file reste persistante :
une reprise `continue` est possible sans recréer les succès. after() utilise la
limite de la fonction courante : les continuations passent par de nouvelles
invocations HTTP acquittées avant leur traitement, pas une longue récursion locale.

## Variables requises avant activation

Conserver les variables existantes ; vérifier sans afficher leurs valeurs :
NEXT_PUBLIC_SUPABASE_URL (Production attendue), SUPABASE_SERVICE_ROLE_KEY,
RESEND_API_KEY, RESEND_FROM (domaine vérifié, pas l'expéditeur de développement),
CRON_SECRET et NEXT_PUBLIC_APP_URL ou NEXT_PUBLIC_SITE_URL (origine HTTPS canonique).
La nouvelle variable ACCOUNTANT_MONTHLY_ENABLED doit rester absente/false jusqu'à
l'autorisation d'activation. Aucun repli sur un domaine Preview n'est utilisé.

## Validation locale et étapes restantes

Les tests automatisés simulent entièrement Resend et Supabase Storage. Les tests
SQL sont réservés à un PostgreSQL jetable minimal, jamais à une base Supabase.
Le test de concurrence refuse les hôtes TCP et n'accepte qu'un socket
/private/tmp/drimli-accountant-pg.*. Les essais Next.js utilisent la désactivation
explicite et vérifient uniquement les refus attendus, sans appels métier externes.

Avant production, avec nouvelles autorisations :
1. Revoir la migration et vérifier en lecture seule les dépendances/droits réels.
2. Autoriser séparément l'application de ce fichier précis ; aucune application
   globale de migrations ni réparation de monthly_statements n'est nécessaire.
3. Valider en environnement autorisé le stockage privé, l'expéditeur, l'origine
   canonique, la continuation HTTP/after et les règles de protection Vercel.
4. Vérifier le forfait et les quotas Resend/Storage/Functions adaptés au volume.
5. Valider une répétition sans e-mail réel, puis autoriser séparément publication,
   activation du flag et ajout des trois crons. Prévoir la surveillance des états
   failed/blocked/uncertain et des continuations interrompues.

L'ancienne route /api/billing/monthly est neutralisée : elle retourne 410 sans accès aux données ni envoi. Aucun changement
Stripe, remboursement, numérotation, calendrier ou contenu de facture/avoir.

Sources techniques :
- https://vercel.com/docs/cron-jobs/usage-and-pricing
- https://nextjs.org/docs/app/api-reference/functions/after
- https://resend.com/docs/dashboard/emails/idempotency-keys

## Résultats de cette session

- TypeScript : succès (`tsc --noEmit --incremental false`).
- ESLint ciblé : succès ; git diff --check : succès.
- 55 tests Node réussis : 19 tests du nouveau traitement/liens, 4 tests de dates,
  13 tests de liste/téléchargement, 13 tests ZIP et 6 tests de l'adresse comptable.
- Migration appliquée et tests SQL réussis exclusivement sur PostgreSQL local
  jetable : sélection sans adresse/sans document et avoirs seuls, transitions,
  leases périmées, reprise après rejet, refus des reprises incertaines tardives,
  protection des succès, renouvellement isolé et droits anon/authenticated.
- Test de deux connexions PostgreSQL concurrentes : un seul détenteur de lease,
  une seule tentative enregistrée.
- Six routes vérifiées via Next.js local avec le flag explicitement false :
  refus 401 des tâches non authentifiées et 503 des fonctionnalités désactivées.
- Aucun test d'intégration connecté à Supabase ou Resend. Les services Next.js
  et PostgreSQL temporaires ont été arrêtés après vérification.

## Fichiers de cette étape

- supabase/migrations/20261025120000_accountant_monthly_deliveries.sql
- supabase/tests/accountant_monthly_deliveries.sql
- supabase/tests/accountant_monthly_concurrency.mjs
- lib/accountantMonthlyDelivery.ts
- lib/accountantMonthlyDelivery.test.mjs
- lib/accountantMonthlyEmail.ts
- lib/accountantMonthlyHttp.ts
- lib/email.ts (deux adaptateurs Resend ajoutés ; fonctions existantes inchangées)
- app/api/cron/accountant-monthly/route.ts
- app/api/cron/accountant-monthly/summer/route.ts
- app/api/cron/accountant-monthly/winter/route.ts
- app/api/cron/accountant-monthly/continue/route.ts
- app/api/cron/accountant-monthly/cleanup/route.ts
- app/api/accountant-documents/download/route.ts
- app/api/dashboard/client-documents/accountant-links/route.ts
- app/dashboard/factures/AccountantMonthlyLinks.tsx
- app/dashboard/factures/page.tsx (ajout du composant de renouvellement seulement)
- docs/envoi-mensuel-comptable-preparation.md

Les autres changements locaux préexistants, notamment le générateur ZIP commun,
les réglages de facturation et la navigation Factures, sont préservés.


## Corrections de l’audit de sécurité — 29 octobre 2026

- Nouvelle migration locale `20261029120000_protect_accountant_email.sql` : retire
  SELECT sur la table aux rôles publics/authentifiés puis réaccorde la lecture de
  toutes les colonnes existantes sauf accountant_email. La RLS reste inchangée.
  Les API serveur authentifiées conservent la lecture/sauvegarde du champ privé.
  Les sélections explicites des pages publiques et de réservation sont conservées.
  La migration vérifie les privilèges effectifs et échoue transactionnellement
  si un héritage de rôle expose encore l’adresse. Aucune application effectuée.
- La migration du journal, toujours locale et non appliquée à Supabase, introduit
  `exhausted` et `recover_accountant_deliveries()`. Après dix tentatives, aucun
  redémarrage automatique ou retry explicite n’est accepté. Examiner le journal ;
  aucun reset/forçage n’est exposé. Une incertitude conserve son payload et peut
  encore être réconciliée avec une preuve Resend, sans nouveau message.
- La maintenance quotidienne cleanup récupère aussi la file durable : préparation
  abandonnée -> pending si tentatives restantes, soumission possible -> uncertain,
  tentatives épuisées sans soumission -> exhausted. Les verrous actifs restent
  intacts. Une continuation perdue est ainsi récupérable lors de la maintenance
  suivante, à condition que celle-ci soit ultérieurement autorisée et planifiée.
  Aucun cron n’a été ajouté/activé. Les erreurs certaines restent à relance manuelle.
- La purge peut réserver un ancien preparing/sending dont le verrou a expiré ;
  son statut précédent est journalisé. Les chemins restent limités aux ZIP
  techniques, les PDF originaux ne sont jamais supprimés. Lot maximal 20 archives,
  arrêt avant épuisement du budget ; le passage suivant reprend les restantes.
- La signature Storage respecte la durée restante du lien ET de l’archive, avec
  marge d’arrondi et vérification de l’expiration JWT retournée. Un format non
  reconnu ou une expiration excessive est refusé. Un lien signé déjà délivré ne
  devient pas révocable immédiatement lors d’un changement d’adresse/renouvellement.

Les tests Node de permissions sont des contrôles statiques de non-régression,
pas une preuve du schéma effectif. Les assertions SQL de droits et les scénarios
PostgreSQL de récupération concurrente sont préparés, mais non exécutés lors de
cette correction : aucune migration n’a été appliquée, même sur une base jetable.
Restent à autoriser : validation SQL isolée, contrôle des droits réels et du bucket
privé, format des URL Storage, budgets/continuations Vercel, puis publication et
activation séparées. Aucune donnée DEV/Production ni aucun e-mail réel touché.

Validation de cette correction : 71 tests Node réussis (55 conservés, 16 ajoutés),
TypeScript sans émission ni cache incrémental et ESLint ciblé réussis.
Contrôle des espaces Git réussi, y compris sur les nouveaux fichiers concernés.
Les tests SQL/concurrence PostgreSQL ont été enrichis mais non exécutés.
