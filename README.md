# GovStackMavimpi – Dossier Patient Hospitalier (GovStack Santé RDC)

Première solution **GovStack** pour le secteur de la santé en République Démocratique du Congo :
une application web de **gestion des malades** pour les hôpitaux, hébergée sur un VPS.
Les **médecins** gèrent les dossiers ; chaque **malade** accède à **sa propre fiche** en ligne.

## Fonctionnalités

| Profil | Ce qu'il peut faire |
|---|---|
| **Médecin** | Rechercher / créer des fiches patients (avec **Numéro Unique Patient – NUP**), consultations (signes vitaux, diagnostic CIM‑10, ordonnance), demandes et résultats d'examens, hospitalisations (admission / sortie), rendez‑vous, création de l'accès en ligne du patient, export FHIR, impression de la fiche |
| **Infirmier(ère)** | Accueil et création des fiches, lecture des dossiers (tracée), **soins infirmiers** (signes vitaux, glycémie, notes de soins, médicaments administrés), saisie des résultats d'examens, rendez‑vous de son établissement. **Ne pose pas de diagnostic, ne prescrit pas, ne demande pas d'examen, n'admet pas et ne fait pas sortir un patient.** |
| **Patient** | Consulter **uniquement sa fiche** (identité, consultations, ordonnances, résultats, hospitalisations), demander / annuler un rendez‑vous, voir **qui a consulté son dossier**, télécharger son dossier (FHIR), changer son mot de passe |
| **Administrateur** | Gérer les établissements (26 provinces), les comptes du personnel (médecins, infirmiers), réinitialiser les mots de passe, consulter le journal d'audit. **N'a pas accès au contenu médical.** |

Sécurité : mots de passe hachés (scrypt), sessions révocables (cookie `HttpOnly`/`SameSite=Strict`),
mot de passe temporaire à changer à la première connexion, limitation des tentatives de connexion,
en‑têtes de sécurité (CSP, HSTS…), **journal d'audit de chaque lecture/écriture** d'un dossier,
données jamais mises en cache, HTTPS automatique (Caddy + Let's Encrypt).

Interopérabilité : API **HL7 FHIR R4** (`/fhir/r4/Patient/{NUP}` et `/$everything`) pour l'échange
avec les autres systèmes via le Building Block GovStack *Information Mediator*. Voir
[docs/ARCHITECTURE-GOVSTACK.md](docs/ARCHITECTURE-GOVSTACK.md).

## Démarrage rapide (poste de développement)

Prérequis : **Node.js ≥ 22.13** (la base SQLite est intégrée à Node, aucune autre installation).

```bash
npm install
npm run seed:demo   # données fictives : dr.demo, inf.demo, patient CD-2026-000001-1 – mot de passe Demo2026!
npm start           # http://localhost:3000
npm test            # tests de l'API
```

Sans `seed:demo`, un compte `admin` est créé au premier démarrage et son mot de passe temporaire
est affiché dans la console.

## Mise en production sur VPS

```bash
git clone <ce dépôt> /opt/govstack-sante && cd /opt/govstack-sante
cp .env.example .env && nano .env      # DOMAIN, ACME_EMAIL…
docker compose up -d --build
docker compose logs app | grep -A2 "administrateur"   # mot de passe admin initial
```

Guide complet (DNS, pare‑feu, sauvegardes, mise à jour, variante sans Docker) :
[docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md).

## Organisation du code

```
src/
  server.js          démarrage, création du compte admin initial
  app.js             application Express, sécurité, routage, erreurs
  db.js              schéma SQLite et migrations
  auth.js            mots de passe, sessions, rôles
  audit.js           journal d'audit
  validation.js      validation des données reçues
  constants.js       référentiels (provinces, groupes sanguins…)
  routes/            auth, admin, patients (+ soins), rendez-vous, fhir
public/              interface web (HTML/CSS/JS sans dépendance)
scripts/             create-admin, backup, seed-demo
deploy/              Caddyfile, service systemd, cron de sauvegarde
test/                tests de bout en bout de l'API
```

## Parcours type

1. L'**administrateur** crée l'établissement puis les comptes des médecins et infirmiers (mot de passe temporaire affiché une seule fois).
2. Le **médecin** crée la fiche du malade → un NUP est attribué (ex. `CD-2026-000001-1`, avec chiffre de contrôle).
3. Le médecin enregistre consultations, examens, hospitalisations, rendez‑vous.
4. Sur la fiche, « Créer l'accès patient » génère un identifiant (= NUP) et un mot de passe temporaire à remettre au malade.
5. Le **malade** se connecte, choisit son mot de passe et consulte sa fiche, ses résultats et ses rendez‑vous.

## API REST (résumé)

| Méthode | Chemin | Rôle |
|---|---|---|
| POST | `/api/auth/login`, `/api/auth/logout`, `/api/auth/password` · GET `/api/auth/me` | tous |
| GET/POST | `/api/patients` (recherche `?q=`), GET/PATCH `/api/patients/:id` | médecin, infirmier (GET `:id` : aussi le patient lui‑même) |
| POST | `/api/patients/:id/soins` | médecin, infirmier |
| POST | `/api/patients/:id/consultations`, `/examens`, `/hospitalisations`, `/compte` | médecin |
| PATCH | `/api/examens/:id/resultat` | médecin, infirmier |
| PATCH | `/api/hospitalisations/:id/sortie` | médecin |
| GET | `/api/patients/:id/acces` | médecin, infirmier, patient concerné |
| GET/POST/PATCH | `/api/rendez-vous` | médecin, infirmier, patient |
| GET/POST/PATCH | `/api/etablissements`, `/api/users`, GET `/api/audit` | admin |
| GET | `/fhir/r4/metadata`, `/fhir/r4/Patient/:nup`, `/fhir/r4/Patient/:nup/$everything` | médecin, infirmier, patient concerné |

L'API accepte le cookie de session ou un en‑tête `Authorization: Bearer <token>` (jeton renvoyé par `/api/auth/login`).

## Licence

MIT
