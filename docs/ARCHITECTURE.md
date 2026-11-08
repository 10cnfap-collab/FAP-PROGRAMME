# Plateforme de gestion du programme scientifique — FAP

Document d'architecture · Phase 1 (fondations + constructeur) · novembre 2026

## 1. Vue d'ensemble

```
┌────────────────────────── Navigateur ──────────────────────────┐
│ index.html                                                     │
│  ├─ Programme public (sans connexion) : par jour, par salle,   │
│  │  chronologique, intervenants, thèmes, ligne « en direct »   │
│  └─ Administration : tableau de bord, constructeur 5 salles,   │
│     sessions, intervenants, symposiums, journal, configuration │
│ lib/programme.js  ← règles métier (même fichier que le serveur)│
└───────────────┬────────────────────────────────────────────────┘
                │ POST /api {fn, args, token}
┌───────────────▼──────────── Vercel (serverless) ────────────────┐
│ api/index.js : authentification, limitation des tentatives,    │
│                appel du service partagé lib/programme.js        │
└───────────────┬────────────────────────────────────────────────┘
                │ REST
┌───────────────▼──────────── Upstash Redis (Vercel Storage) ─────┐
│ prog10:congress · prog10:sessions · prog10:persons · audit      │
└─────────────────────────────────────────────────────────────────┘
```

**Pourquoi ce socle pour la phase 1.** Il reprend exactement le mode de déploiement de la plateforme des résumés : GitHub, Vercel et la base Upstash déjà en service. On peut donc le mettre en ligne sans compilation et sans nouveau compte. Les règles métier sont isolées dans `lib/programme.js` : conflits, publication, instantanés publics, fusion, audit. Le passage à Next.js + PostgreSQL (section 4) ne réécrira donc que la couche de stockage et l'interface, pas les règles.

**Principe de sécurité central.** Le public ne lit jamais les sessions de travail. À la publication, le serveur fige un **instantané public** nettoyé : sans e-mail, téléphone, notes internes, statut commercial ni élément masqué. Une modification ultérieure fait passer la session en « Modifié après publication » : le public continue de voir l'ancienne version jusqu'à la republication. Un brouillon enregistré ne peut donc jamais apparaître en ligne.

## 2. Modules et état d'avancement

| Module | Phase | État |
|---|---|---|
| 1. Administration du programme (constructeur, conflits, publication, audit) | 1–2 | **Livré** : grille 5 salles, glisser-déposer contraint, 3 formats, symposiums, cérémonies, statuts, visibilité, journal |
| 2. Programme public | 3 | **Livré (base)** : 5 vues, recherche, ligne temps réel Africa/Algiers, mobile |
| 3. Annuaire des intervenants | 1–3 | **Livré** : fiche unique, rôles multiples, normalisation proposée, doublons, fusion |
| 4. Portail personnalisé (comptes, rôles, agenda) | 4 | À faire |
| 5. Communications et notifications | 5 | À faire (réutiliser le module e-mail SMTP de la plateforme des résumés) |
| 6. Attestations PDF + QR | 5 | À faire |
| 7. Intégration résumés | 6 | Préparé : champ « Réf. résumé » par conférence, identifiants stables, export CSV |

## 3. Navigation d'administration

```
Tableau de bord   KPI, sessions par salle, statuts, sessions les moins prêtes
Constructeur      Jours en onglets · 5 salles en colonnes · conflits du jour · publication groupée
Sessions          Tableau filtrable (statut, format, salle, thème) · actions groupées
Intervenants      Annuaire unique · doublons · fusion · affectations
Symposiums        Créneaux disponibles / réservés / attribués
Journal           Qui, quand, quoi, valeurs avant → après
Configuration     Édition, dates, salles, fermetures plénières, trame horaire, thèmes, données
```

## 4. Schéma relationnel cible (PostgreSQL)

Les documents JSON de la phase 1 reprennent ces entités champ pour champ, ce qui rend la migration mécanique.

```sql
CREATE TABLE congress (
  id text PRIMARY KEY, name text NOT NULL, short_name text NOT NULL,
  city text, venue text, country text DEFAULT 'Algérie',
  timezone text NOT NULL DEFAULT 'Africa/Algiers', locale text NOT NULL DEFAULT 'fr',
  day_start time NOT NULL DEFAULT '08:30', day_end time NOT NULL DEFAULT '20:30',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE congress_day (
  id serial PRIMARY KEY, congress_id text REFERENCES congress ON DELETE CASCADE,
  date date NOT NULL, label text, UNIQUE (congress_id, date)
);
CREATE TABLE room (
  id text PRIMARY KEY, congress_id text REFERENCES congress ON DELETE CASCADE,
  name text NOT NULL, position int NOT NULL, is_main boolean DEFAULT false
);
CREATE TABLE room_block (            -- fermetures (séquence plénière du jour 1)
  id serial PRIMARY KEY, congress_id text REFERENCES congress ON DELETE CASCADE,
  day date NOT NULL, starts time NOT NULL, ends time NOT NULL, label text
);
CREATE TABLE room_block_room (block_id int REFERENCES room_block ON DELETE CASCADE, room_id text REFERENCES room, PRIMARY KEY (block_id, room_id));
CREATE TABLE time_slot_template (
  id serial PRIMARY KEY, congress_id text REFERENCES congress ON DELETE CASCADE,
  starts time NOT NULL, ends time NOT NULL, kind text CHECK (kind IN ('session','symposium','break')), label text
);
CREATE TABLE person (
  id text PRIMARY KEY, title text, first_name text NOT NULL, last_name text NOT NULL, display_name text,
  function text, institution text, department text, city text, country text,
  email citext, phone text, bio text, bio_public boolean DEFAULT false, specialties text,
  visible boolean DEFAULT true, external_id text,       -- identifiant de la plateforme des résumés
  version int NOT NULL DEFAULT 1, updated_at timestamptz, updated_by text
);
CREATE UNIQUE INDEX person_email_uq ON person (email) WHERE email IS NOT NULL;
CREATE TABLE affiliation (id serial PRIMARY KEY, person_id text REFERENCES person ON DELETE CASCADE, label text NOT NULL, position int);
CREATE TYPE pub_state AS ENUM ('brouillon','en_preparation','a_valider','valide','publie','modifie','annule','archive');
CREATE TYPE session_type AS ENUM ('lectures','panel','workshop','symposium','break','ceremony');
CREATE TABLE scientific_session (
  id text PRIMARY KEY, congress_id text REFERENCES congress, type session_type NOT NULL,
  num int,                                   -- numéro affiché : S01, SY01, C01 (unique par congrès et par famille)
  title text NOT NULL CHECK (length(trim(title)) > 0), subtitle text, description text, theme text,
  day date NOT NULL, starts time NOT NULL, ends time NOT NULL CHECK (ends > starts),
  room_id text REFERENCES room, all_rooms boolean DEFAULT false,
  status pub_state NOT NULL DEFAULT 'brouillon', visible boolean NOT NULL DEFAULT true,
  discussion_min int, ceremony_kind text, notes_private text,
  -- atelier
  objectives text, audience text, capacity int, registration_required boolean, logistics text,
  public_snapshot jsonb, published_at timestamptz, published_by text,
  version int NOT NULL DEFAULT 1, created_at timestamptz, created_by text, updated_at timestamptz, updated_by text
);
CREATE TABLE lecture (
  id text PRIMARY KEY, session_id text REFERENCES scientific_session ON DELETE CASCADE,
  position int NOT NULL, title text, speaker_id text REFERENCES person, duration_min int NOT NULL DEFAULT 20,
  abstract_ref text, visible boolean DEFAULT true
);
CREATE TYPE assignment_role AS ENUM ('moderateur','paneliste','animateur','formateur','intervenant');
CREATE TABLE session_assignment (
  session_id text REFERENCES scientific_session ON DELETE CASCADE, person_id text REFERENCES person,
  role assignment_role NOT NULL, position int, confirmed_at timestamptz,
  PRIMARY KEY (session_id, person_id, role)
);
CREATE TABLE sponsor (id serial PRIMARY KEY, name text NOT NULL, logo_url text);
CREATE TABLE symposium (
  session_id text PRIMARY KEY REFERENCES scientific_session ON DELETE CASCADE,
  sponsor_id int REFERENCES sponsor, speaker_id text REFERENCES person, presentation_title text,
  commercial_status text CHECK (commercial_status IN ('disponible','reserve','attribue')), details_visible boolean DEFAULT true
);
CREATE TABLE abstract_reference (    -- phase 6
  id text PRIMARY KEY, source text DEFAULT 'fap10-resumes', title text, decision text, presentation text,
  person_id text REFERENCES person, lecture_id text REFERENCES lecture, imported_at timestamptz
);
CREATE TABLE user_account (          -- phase 4
  id serial PRIMARY KEY, person_id text REFERENCES person, email citext UNIQUE NOT NULL,
  password_hash text, must_change boolean DEFAULT true, activation_token_hash text, token_expires timestamptz,
  failed_logins int DEFAULT 0, locked_until timestamptz
);
CREATE TABLE user_role (user_id int REFERENCES user_account ON DELETE CASCADE, role text NOT NULL, PRIMARY KEY (user_id, role));
CREATE TABLE notification (id serial PRIMARY KEY, user_id int REFERENCES user_account, title text, body text, created_at timestamptz DEFAULT now(), read_at timestamptz);
CREATE TABLE email_template (id text PRIMARY KEY, name text, subject text, body text);
CREATE TABLE email_delivery (id serial PRIMARY KEY, template_id text, to_email citext, person_id text, status text, error text, sent_at timestamptz, scheduled_for timestamptz);
CREATE TABLE certificate (
  id text PRIMARY KEY, number text UNIQUE NOT NULL, person_id text REFERENCES person, session_id text,
  category text NOT NULL, status text CHECK (status IN ('brouillon','valide','genere','envoye')),
  verify_hash text UNIQUE, issued_at timestamptz,
  UNIQUE (person_id, session_id, category)          -- pas de doublon d'attestation
);
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), actor text NOT NULL,
  action text NOT NULL, target text, label text, changes jsonb
);
CREATE TABLE programme_version (id serial PRIMARY KEY, created_at timestamptz DEFAULT now(), created_by text, label text, data jsonb NOT NULL);
```

## 5. Règles appliquées côté serveur

| Règle | Niveau |
|---|---|
| Titre obligatoire | Bloque la publication |
| Salle réservée deux fois | Bloque · glisser-déposer refusé |
| Session dans une salle fermée (plénière du jour 1) | Bloque · glisser-déposer refusé · création refusée |
| Même personne dans deux activités simultanées (orateur, modérateur, panéliste, animateur, orateur de symposium) | Bloque |
| Durée des conférences + discussion > durée de la session | Bloque |
| Personne supprimée encore affectée | Bloque |
| Modérateur, orateur, panéliste ou animateur manquant ; temps non attribué ; symposium sans sponsor | Alerte |
| Modification après publication | Statut « Modifié après publication », le public garde l'ancienne version |
| Masquer un élément | Retrait immédiat du public |
| Annuler ou archiver | Retrait immédiat du public |
| Écritures concurrentes | Refus si la version a changé entre-temps |
| Numéro de session (S01…, SY01…, C01…) | Unique par famille ; attribué automatiquement à la création, modifiable, renumérotation chronologique possible |
| Échange de contenu entre deux sessions | Le créneau (numéro, jour, heure, salle) reste en place ; le contenu est interverti. Contrôle des chevauchements avant l'échange : nouveaux conflits critiques affichés ; l'échange demande alors une confirmation explicite et la publication reste bloquée. Un créneau déjà en ligne passe en « Modifié après publication » |

## 6. API (phase 1)

`POST /api` avec le corps `{ "fn": "...", "args": [...], "token": "..." }`. La réponse a la forme `{ ok, data }` ou `{ ok: false, error }`.

| Action | Accès | Arguments |
|---|---|---|
| `getPublic` | public | – |
| `login` | public | mot de passe, nom |
| `getState` | admin | – |
| `saveCongress` | admin | configuration |
| `saveSession` | admin | session, version attendue |
| `importSessions` | admin | liste (trame) |
| `setStatus` | admin | id, statut |
| `setVisible` | admin | id, booléen |
| `publishMany` | admin | ids |
| `deleteSession` | admin | id (archivage si déjà publiée) |
| `savePerson` / `deletePerson` / `mergePersons` | admin | – |
| `swapSessions` | admin | id A, id B, versions attendues, confirmation |
| `renumber` | admin | – |
| `seedDemo` / `clearProgramme` | admin | – |

Phase 6 : ajout d'une API REST versionnée (`/api/v1/abstracts/import`, `/api/v1/programme`) avec clé d'intégration. Les deux plateformes peuvent partager la même base Upstash grâce aux préfixes distincts (`fap10:` pour les résumés, `prog10:` pour le programme). L'import des résumés acceptés pourra donc se faire sans export manuel.

## 7. Feuille de route

1. **Phase 2 (suite)** : versions du programme (créer, comparer, restaurer), listes de préparation par session, notifications de changement.
2. **Phase 3** : agenda personnel, pages intervenant publiques, exports PDF (par jour, par salle, par intervenant).
3. **Phase 4** : comptes utilisateurs. Invitation par lien d'activation, mots de passe hachés (scrypt), verrouillage après échecs, onze rôles, tableaux de bord personnels.
4. **Phase 5** : modèles d'e-mails (invitation, modérateur, changement de salle…), envoi groupé et programmé, suivi des échecs. Attestations PDF numérotées avec QR de vérification.
5. **Phase 6** : import des résumés acceptés (oral/poster) depuis la plateforme des résumés, rattachement aux sessions et éligibilité aux attestations.

À partir de la phase 4, le passage à Next.js + TypeScript + PostgreSQL (Neon, via Vercel Storage) est recommandé, en reprenant le schéma de la section 4.
