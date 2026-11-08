# Programme scientifique — Fédération Algérienne de Pharmacie

Plateforme de construction, de validation et de publication du programme scientifique du 10e Congrès de la FAP (22–23 décembre 2026, Alger). Elle est conçue pour servir aux éditions suivantes.

Phase 1 : constructeur 5 salles, 3 formats de session, symposiums, cérémonies, conflits, publication contrôlée, annuaire des intervenants, journal et programme public en direct.
L'architecture et le schéma de base de données sont décrits dans `docs/ARCHITECTURE.md`.

```
index.html          Application (programme public + administration)
lib/programme.js    Règles métier partagées navigateur / serveur
api/index.js        API Vercel
config.js           "/api" = production · "" = démonstration
docs/ARCHITECTURE.md
```

## Mise en ligne (même méthode que la plateforme des résumés)

1. **GitHub** : créez un nouveau dépôt, par exemple `FAP-PROGRAMME`. Avec **Add file › Upload files**, glissez **le contenu** du dossier, y compris les dossiers `api`, `lib` et `docs`, puis faites un **Commit**.
   Vérifiez que les dossiers s'appellent bien `api` et `lib`, en minuscules.
2. **Vercel** : **Add New › Project**, choisissez le dépôt, Framework **Other**, puis **Deploy**.
3. **Base de données** : projet › **Storage** › **Connect Database**. Choisissez la base **Upstash** déjà créée pour les résumés (ou créez-en une, offre gratuite), puis **Connect**.
   Les données du programme utilisent le préfixe `prog10:`. Elles ne se mélangent pas avec celles des résumés.
4. **Variables** : **Settings › Environment Variables**, puis ajoutez :
   - `ADMIN_PASSWORD` : le mot de passe du comité ;
   - `SESSION_SECRET` : une longue suite aléatoire.
5. **Deployments › ⋯ › Redeploy**.
6. **Vérification** : `https://<projet>.vercel.app/api` doit afficher `"db":true,"admin":true`.

## Premiers pas

1. Ouvrez le site, cliquez sur **Administration**, saisissez votre nom (il apparaît dans le journal) et le mot de passe.
2. Pour tester le programme, ouvrez **Configuration** et cliquez sur **Charger les données de démonstration**. Pour repartir de zéro, ouvrez le **Constructeur**, choisissez un jour, puis **Générer la trame horaire du jour**.
3. Cliquez sur un créneau pour le compléter : titre, modérateurs, conférences et orateurs. Glissez un bloc pour le déplacer.
4. Faites avancer chaque session : Brouillon → En préparation → À valider → Validé → **Publier**.
5. Avant le lancement réel, utilisez **Configuration › Vider le programme** pour effacer la démonstration.

Le programme public est accessible sans connexion à l'adresse du site. Le lien direct vers l'administration se termine par `#admin`.

## Ce qui reste simulé en phase 1

- Un **mot de passe unique** protège l'administration. Le nom saisi à la connexion trace les modifications. Les comptes individuels et les 11 rôles arrivent en phase 4.
- Les **e-mails**, les **attestations PDF** et l'**import des résumés** arrivent en phases 5 et 6.
- Le **mode démonstration** (`config.js` vide) garde les données dans le navigateur uniquement.
