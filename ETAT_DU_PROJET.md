# DRIMLI — État du projet

> Ce document décrit l'état réel du projet. Il est mis à jour au fur et à mesure de l'avancement.

---

# 1. Vision

# 1. Vision

## Objectif

Drimli est une plateforme qui permet à un professionnel de vendre des prestations à distance de manière simple.

Le professionnel crée son compte, configure ses services et ses disponibilités, puis partage son lien de réservation.

Le client choisit un créneau, paie en ligne, reçoit toutes les informations nécessaires et participe au rendez-vous avec l'outil choisi par le professionnel.

Drimli automatise toute la partie administrative afin que le professionnel puisse se concentrer sur son métier.

---

## Pour qui ?

Drimli est destiné à toute profession proposant des prestations à distance, par exemple :

- Psychologues
- Coachs
- Formateurs
- Professeurs particuliers
- Consultants
- Avocats
- Diététiciens
- Orthophonistes
- Traducteurs
- Experts-comptables
- Toute activité de conseil ou d'accompagnement à distance

---

## Ce que Drimli fait

- Création d'un profil professionnel
- Présentation des services proposés
- Gestion des disponibilités
- Réservation en ligne
- Paiement sécurisé
- Confirmation automatique
- Génération des factures
- Gestion des rendez-vous

---

## Ce que Drimli ne fait pas

Drimli n'est pas un logiciel de visioconférence.

Le professionnel reste libre d'utiliser l'outil qu'il préfère (Zoom, WhatsApp, Google Meet, Teams, téléphone, etc.).

Drimli organise le rendez-vous, mais n'impose jamais l'outil utilisé pour réaliser la prestation.

---

# 2. Parcours professionnel

- [ ] Créer un compte

- [ ] Se connecter

- [ ] Compléter son profil

- [ ] Créer un service

- [ ] Définir ses disponibilités

- [ ] Recevoir des paiements

- [ ] Gérer ses rendez-vous

- [ ] Télécharger ses factures

---

# 3. Parcours patient

- [ ] Choisir un professionnel

- [ ] Réserver un créneau

- [ ] Payer

- [ ] Rejoindre le rendez-vous

- [ ] Recevoir une facture

---

# 4. Fonctionnalités existantes

| Fonctionnalité | État | Remarques |

|---------------|------|-----------|

| Création de compte | ✅ | Email + mot de passe. Avec une adresse neuve, le compte est créé et l’utilisateur est redirigé vers la création d’un service. |Une tentative de création a échoué avec l’erreur `profiles_slug_unique`|Une tentative de création a échoué avec l’erreur `User already registered`

| Connexion | ✅ | Email + mot de passe  testée le 26/07/2026 |

| Profil professionnel | ✅ |

Onboarding Stripe | 🟡 | Après la création d’un service, l’utilisateur est envoyé vers “Recevoir un paiement” et semble bloqué tant que Stripe n’est pas entièrement configuré. Aucun accès évident au tableau de bord. ||

| Services | ✅ | Fonctionnel |

| Disponibilités | ✅ | Blocages ajoutés |

| Réservation | ❓ | À vérifier |

| Paiement | ❓ | À vérifier |

| Rendez-vous | ✅ | Gestion des rendez-vous |

| Facturation | 🟡 | Génération OK, téléchargement à finaliser |
---

# 5. Tables Supabase

À compléter.

---

# 6. Pages importantes

À compléter.

---

# 7. Décisions prises

À compléter.

---

# 8. Idées pour plus tard

## Évolutions possibles

### V2

- Intégration facultative d'une salle de visioconférence (Jitsi ou équivalent).

- Le professionnel reste libre de continuer à utiliser son outil habituel.

Cette fonctionnalité est optionnelle et ne fait pas partie du cœur de Drimli.