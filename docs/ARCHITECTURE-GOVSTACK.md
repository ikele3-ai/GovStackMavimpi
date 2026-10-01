# Architecture et alignement GovStack

## Vue d'ensemble

```
 Navigateur (médecin / patient / admin)
          │  HTTPS
          ▼
 ┌─────────────────┐     ┌──────────────────────────────────────────┐
 │ Caddy (TLS)     │────▶│ Application Node.js (Express)            │
 └─────────────────┘     │  • Interface web (public/)               │
                         │  • API REST /api  • API FHIR R4 /fhir/r4 │
                         │  • Authentification, rôles, audit        │
                         └───────────────┬──────────────────────────┘
                                         ▼
                              SQLite (WAL) – volume /data
                              + sauvegardes quotidiennes
```

Choix techniques : une seule dépendance d'exécution (Express), base SQLite intégrée à Node.js
(aucun serveur de base de données à administrer), interface sans framework (rapide sur des
connexions lentes, fonctionne sur mobile). Ce socle suffit pour un hôpital ou une province ; le
passage à PostgreSQL est prévu dans la feuille de route si la charge l'exige.

## Correspondance avec les Building Blocks GovStack

| Building Block GovStack | Implémentation dans cette version | Évolution prévue |
|---|---|---|
| **Identity** | Numéro Unique Patient (NUP) avec chiffre de contrôle ; comptes et rôles locaux | Rattachement au futur identifiant national (ONIP) via l'Identity BB, authentification OpenID Connect |
| **Registration** | Enregistrement des patients, détection des doublons | Formulaires d'enregistrement configurables |
| **Digital Registries** | Registres patients, établissements (26 provinces, zones de santé) et professionnels | Synchronisation avec le registre national des établissements / professionnels (CNOM) |
| **Consent** | Transparence : chaque patient voit qui a consulté son dossier | Gestion explicite des consentements de partage inter‑établissements |
| **Scheduling** | Rendez‑vous : demande par le patient, confirmation par le médecin | Rappels automatiques |
| **Messaging** | — | Rappels de rendez‑vous et résultats par SMS (Messaging BB) |
| **Payments** | — | Paiement mobile des frais (M‑Pesa, Airtel Money, Orange Money) via le Payments BB |
| **Information Mediator** | API **HL7 FHIR R4** normalisée (Patient, Encounter, Condition, Observation, MedicationRequest, ServiceRequest, DiagnosticReport, AllergyIntolerance) | Publication des services sur X‑Road ; remontée d'indicateurs vers DHIS2 (SNIS) |
| **Security** | HTTPS, scrypt, sessions révocables, CSP, limitation des tentatives, journal d'audit complet, principe du moindre privilège (l'admin ne voit pas les données cliniques) | Double authentification, chiffrement des sauvegardes intégré |

## Modèle de données

- `etablissements` – hôpitaux et centres de santé
- `users` – comptes (`admin`, `medecin`, `infirmier`, `patient` lié à une fiche)
- `patients` – fiche : identité (nom, postnom, prénom), coordonnées, groupe sanguin, allergies, antécédents, contact d'urgence
- `consultations` (+ `prescriptions`) – signes vitaux, diagnostic, code CIM‑10, traitement
- `soins` – soins infirmiers : signes vitaux, glycémie, note de soins (rattachés à l'hospitalisation en cours)
- `examens` – demande puis résultat
- `hospitalisations` – admission, service/chambre/lit, sortie
- `rendez_vous`
- `audit_log` – toute action sur un dossier (lecture comprise)
- `sessions`

Les consultations sont **en ajout seul** (pas de suppression ni de modification), comme il est
d'usage pour un dossier médical ; les corrections se font par une nouvelle consultation.

## Règles d'accès

| Donnée | Admin | Médecin | Infirmier | Patient |
|---|---|---|---|---|
| Établissements, comptes, audit global | ✔ | lecture établissements | lecture établissements | lecture établissements |
| Fiches patients (lecture) | ✘ | ✔ toutes (tracé) | ✔ toutes (tracé) | ✔ la sienne uniquement |
| Création / modification de l'identité | ✘ | ✔ | ✔ | ✘ |
| Soins infirmiers, signes vitaux | ✘ | ✔ | ✔ | ✘ |
| Résultats d'examens | ✘ | ✔ | ✔ | ✘ |
| Diagnostic, prescription, demande d'examen | ✘ | ✔ | ✘ | ✘ |
| Admission / sortie d'hospitalisation | ✘ | ✔ | ✘ | ✘ |
| Accès en ligne du patient | ✘ | ✔ | ✘ | ✘ |
| Journal des accès d'un dossier | ✔ (global) | ✔ | ✔ | ✔ le sien |
| Rendez‑vous | ✘ | créer, confirmer, terminer, annuler | idem, pour tout son établissement | demander, annuler les siens |

## Feuille de route

1. Rappels SMS (Messaging BB) et paiement mobile (Payments BB).
2. Vaccinations (PEV), suivi prénatal (CPN) et courbes de croissance.
3. Rattachement à l'identité nationale et authentification unique (OIDC).
4. Mode hors‑ligne pour les centres de santé à connectivité intermittente.
5. Tableaux de bord épidémiologiques et export vers DHIS2.
6. Rôles supplémentaires : laborantin, réceptionniste ; prescription infirmière dans les centres de santé (paramétrable par établissement).
