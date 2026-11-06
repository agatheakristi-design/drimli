# Aide

Le panneau reprend les styles DRIMLI existants : FAQ de quatre réponses avec recherche
insensible aux accents, formulaire sujet/message et historique des 50 dernières demandes
et réponses. Le lien `/dashboard?aide=1` ouvre le panneau après authentification.

## Demandes et notifications

Le formulaire appelle `POST /api/dashboard/help-requests` avec la session Supabase.
Le serveur vérifie la session puis insère uniquement sujet/message sous les RLS de
l'utilisateur. Le propriétaire est fourni par `auth.uid()` ; aucun propriétaire ou
destinataire fourni par le navigateur n'est utilisé.

Après l'enregistrement, Next.js `after()` traite cette demande précisément, via Resend.
La réponse HTTP confirme l'enregistrement, pas la livraison de l'e-mail. Un échec d'envoi
ne supprime jamais la demande. Les sources persistantes permettent la réconciliation
lors d'une relance administrative même si le processus est interrompu avant mise en file.

Les tables `help_requests`, `help_replies` et `help_notifications` et les fonctions
SQL sont créées par les deux migrations Aide déjà appliquées :
- `20261102120000_create_help_requests.sql`
- `20261102130000_create_help_notification_queue.sql`

Aucune nouvelle migration, aucun cron, aucune dépendance à pg_net ou Vault. Les anciens
objets préparés dans Supabase restent inutilisés. Leurs permissions système ne sont pas
modifiées par cette solution. Aucun secret n'est transmis à une file pg_net.

La file possède une unicité par événement, des prises atomiques et un bail de cinq minutes.
Le premier déclenchement cible uniquement la nouvelle demande ; il ne consomme pas un ancien
élément à sa place. Le destinataire, l'expéditeur, le contenu et la clé d'idempotence Resend
sont figés avant l'envoi. Les éléments envoyés ne sont pas renvoyés. Après 23 heures depuis
la première tentative, un résultat incertain nécessite une vérification administrative
(`attention`) plutôt qu'un renvoi aveugle au-delà de la fenêtre de déduplication Resend.

## Configuration serveur

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` : projet Production vérifié.
- `SUPABASE_SERVICE_ROLE_KEY` : uniquement côté serveur, pour le traitement de la file.
- `RESEND_API_KEY` : clé existante, domaine d'expéditeur vérifié.
- `DRIMLI_HELP_ADMIN_EMAIL=support@drimli.io` : destinataire des nouvelles demandes.
- `DRIMLI_HELP_RESEND_FROM=Drimli <notifications@mail.drimli.io>` : expéditeur dédié.
- `DRIMLI_HELP_APP_URL=https://www.drimli.io` : lien de notification.
- `DRIMLI_HELP_CRON_SECRET` : secret fort dédié à la **relance manuelle**, malgré son nom
  conservé pour réutiliser la configuration existante. Aucun ordonnanceur ne l'utilise.

Les variables des paiements et autres fonctionnalités restent inchangées.

## Répondre et relancer

L'administration consulte les demandes dans Supabase et insère une réponse dans
`help_replies` avec `request_id` et `message`. L'auteur la retrouve dans Aide à la
réouverture du panneau. Une insertion directe dans Supabase ne déclenche pas d'e-mail :
la relance administrative ci-dessous permet aussi d'envoyer la notification de réponse.

Le serveur expose `POST /api/admin/help-notifications/retry`, protégé par le secret dédié
avec comparaison en temps constant. Cette route traite **un** événement admissible et
réconcilie les sources persistantes. Elle respecte les délais de reprise et les baux.
Aucune relance automatique n'est configurée.

Sur une machine administrative de confiance, fournir le secret dans l'environnement du
processus (jamais dans les arguments de commande ou le navigateur), puis lancer :

```sh
node scripts/retry-help-notifications.mjs --send
```

Sans `--send`, le script ne fait aucun appel. Il ne boucle pas et ne retente jamais après
un timeout. Examiner le résultat et les états privés de `help_notifications` avant une
nouvelle invocation. Un statut `sent` signifie accepté par Resend, pas livré ; vérifier
les rejets dans Resend. Les logs applicatifs ne contiennent ni messages ni adresses.

Pour un élément `attention`, vérifier Resend avant toute décision. Si la livraison est
confirmée, enregistrer son identifiant réel et l'état envoyé. Si l'absence d'envoi est
confirmée, une réouverture administrative contrôlée du même élément peut être préparée.
Ne jamais supprimer/recréer l'élément ou inventer un identifiant d'envoi. Si le résultat
reste incertain, ne pas renvoyer.

## Sécurité et validation

Les utilisateurs ne lisent que leurs propres demandes/réponses. Ils ne peuvent modifier,
supprimer ou forger une réponse. La file et ses fonctions restent réservées au serveur.
Les textes sont affichés par React sans interprétation HTML.

Tests : `node --test lib/helpNotifications.test.mjs lib/helpPanel.test.mjs`, TypeScript,
ESLint ciblé, build de production et `git diff --check`. Les suites SQL
`supabase/tests/help_privacy.sql` et `supabase/tests/help_notifications.sql` sont réservées
à une base locale jetable, jamais à la production. Les essais couvrent la concurrence,
l'idempotence, l'authentification, les propriétaires forgés, les pannes et la conservation
des messages. Les tests d'e-mail sont simulés, sans envoi réel.

La version simplifiée ne garantit pas une reprise autonome après panne prolongée :
l'administration doit relancer les éléments en attente. Aucun envoi historique automatique
n'est déclenché au déploiement. Vérifier les éventuelles sources existantes avant une relance.
