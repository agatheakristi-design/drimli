# Synchronisation d'un déplacement avec Google Calendar

Le déplacement conserve les contrôles existants : délai client de 48 heures, limite de
80 jours selon l'engagement existant, politique, créneaux et verrouillage SQL. Aucun
nouveau paiement, remboursement, rendez-vous, événement Google ou lien Meet n'est créé.

## Ordre et preuve de succès

1. La fonction SQL existante déplace le rendez-vous et inscrit l'audit dans la même
   transaction. L'audit est l'intention durable, même si le processus s'arrête ensuite.
2. Le serveur utilise uniquement `video_room_id`, dans le calendrier principal du compte
   Google connecté. Il vérifie le propriétaire et le lien Meet enregistré.
3. Il lit Google, puis relit les dates DRIMLI. Une opération devenue obsolète est refusée.
4. Si nécessaire, il envoie un PATCH contenant uniquement début/fin, avec `If-Match` sur
   l'ETag lu. Les champs de conférence, participants et liens ne sont jamais réécrits.
5. Une nouvelle lecture Google et une nouvelle lecture DRIMLI doivent confirmer les
   mêmes dates et le même lien Meet avant de retourner le succès et lancer les
   notifications normales du déplacement.

Une réponse PATCH perdue déclenche d'abord une lecture ; elle ne provoque jamais une
création ou un PATCH aveugle. Trois tentatives au maximum, budget Google/DB de 18 s.
Une erreur d'identité, révocation, événement absent/supprimé ou conflit avec un nouveau
déplacement exige une reprise/intervention ; aucune réunion de remplacement n'est créée.

## Échec ou interruption

Après le commit SQL, DRIMLI conserve les nouvelles dates et l'audit. Il n'est pas sûr de
les annuler aveuglément : des actions concurrentes peuvent déjà avoir eu lieu.
L'API retourne 503 avec `CALENDAR_SYNC_PENDING`, sans annoncer un succès. Les e-mails
normaux ne sont pas déclenchés sur ce chemin d'échec.

À la réouverture du portail, la présence d'un audit entraîne une vérification réelle de
Google, sans PATCH automatique. Le portail n'annonce pas une synchronisation sur la
seule existence de l'audit : il affiche l'attente si les dates divergent ou si Google
ne peut pas être vérifié. Le bouton de visioconférence est masqué pendant cette attente.
Aucune colonne d'état ni table supplémentaire n'est nécessaire : le résultat est dérivé
de l'audit durable et de l'état actuel des deux calendriers.

## Reprise explicite

- Client : bouton « Réessayer la synchronisation » dans son portail sécurisé. Il appelle
  `POST /api/rendez-vous/{token}/calendar-sync`.
- Professionnel/administration technique :
  `POST /api/appointments/{id}/calendar-sync`, avec le jeton Supabase du professionnel
  authentifié dans le header Authorization Bearer. Le serveur impose son identité.

Ces routes retrouvent le dernier audit, vérifient que ses dates sont toujours celles du
rendez-vous et ne font aucun nouveau déplacement SQL. Elles n'acceptent aucune nouvelle
date, propriétaire ou réunion fourni dans le corps de la requête. Les délais de 48 h ne
sont pas contournés : cette reprise termine seulement la synchronisation d'un déplacement
déjà enregistré, sans permettre une modification supplémentaire.

Après confirmation, le portail est rechargé pour recalculer ses fenêtres d'accès avec les
nouvelles dates. La notification professionnelle utilise sa prise durable existante ;
elle n'est pas renvoyée si déjà traitée. La reprise ne renvoie pas automatiquement
l'e-mail client de déplacement, pour éviter un doublon après une réponse perdue.

Aucun cron ni traitement périodique : après épuisement des tentatives, une reprise
explicite reste nécessaire. Si Google doit être reconnecté ou l'événement est absent,
la reprise ne fabrique pas de nouvelle réunion.

## Tests locaux

Les suites `googleCalendarReschedule.test.mjs`, `clientRescheduleEntry.test.mjs` et les
suites existantes des règles client et des e-mails simulent Google/Resend et Supabase.
Elles vérifient : conservation du Meet, absence de création, réponse perdue, erreurs
Google, conflit ETag, opération obsolète, audit durable après échec, accès aux reprises,
et absence de répétition du déplacement/paiement. Aucun appel réel Google ni e-mail de
test n'est nécessaire.
