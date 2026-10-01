import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Chaque migration est appliquée une seule fois (suivi via PRAGMA user_version).
const MIGRATIONS = [
  `
  CREATE TABLE etablissements (
    id            INTEGER PRIMARY KEY,
    code          TEXT NOT NULL UNIQUE,
    nom           TEXT NOT NULL,
    type          TEXT NOT NULL,
    province      TEXT NOT NULL,
    zone_sante    TEXT,
    adresse       TEXT,
    telephone     TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE patients (
    id                    INTEGER PRIMARY KEY,
    nup                   TEXT NOT NULL UNIQUE,
    nom                   TEXT NOT NULL,
    postnom               TEXT,
    prenom                TEXT,
    sexe                  TEXT NOT NULL CHECK (sexe IN ('M','F')),
    date_naissance        TEXT,
    lieu_naissance        TEXT,
    telephone             TEXT,
    email                 TEXT,
    province              TEXT,
    ville                 TEXT,
    commune               TEXT,
    quartier              TEXT,
    adresse               TEXT,
    profession            TEXT,
    etat_civil            TEXT,
    groupe_sanguin        TEXT,
    allergies             TEXT,
    antecedents           TEXT,
    maladies_chroniques   TEXT,
    contact_urgence_nom   TEXT,
    contact_urgence_tel   TEXT,
    contact_urgence_lien  TEXT,
    assurance             TEXT,
    etablissement_id      INTEGER REFERENCES etablissements(id),
    created_by            INTEGER,
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_patients_nom ON patients(nom, postnom, prenom);
  CREATE INDEX idx_patients_tel ON patients(telephone);

  CREATE TABLE users (
    id                    INTEGER PRIMARY KEY,
    username              TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash         TEXT NOT NULL,
    role                  TEXT NOT NULL CHECK (role IN ('admin','medecin','patient')),
    nom                   TEXT NOT NULL,
    prenom                TEXT,
    email                 TEXT,
    telephone             TEXT,
    specialite            TEXT,
    numero_ordre          TEXT,
    etablissement_id      INTEGER REFERENCES etablissements(id),
    patient_id            INTEGER UNIQUE REFERENCES patients(id),
    actif                 INTEGER NOT NULL DEFAULT 1,
    must_change_password  INTEGER NOT NULL DEFAULT 1,
    last_login_at         TEXT,
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE sessions (
    token_hash   TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at   TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ip           TEXT,
    user_agent   TEXT
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE consultations (
    id                INTEGER PRIMARY KEY,
    patient_id        INTEGER NOT NULL REFERENCES patients(id),
    medecin_id        INTEGER NOT NULL REFERENCES users(id),
    etablissement_id  INTEGER REFERENCES etablissements(id),
    date              TEXT NOT NULL,
    motif             TEXT NOT NULL,
    symptomes         TEXT,
    temperature       REAL,
    tension_sys       INTEGER,
    tension_dia       INTEGER,
    pouls             INTEGER,
    frequence_resp    INTEGER,
    poids             REAL,
    taille            REAL,
    saturation        INTEGER,
    examen_clinique   TEXT,
    diagnostic        TEXT,
    code_cim10        TEXT,
    traitement        TEXT,
    recommandations   TEXT,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_consultations_patient ON consultations(patient_id, date);

  CREATE TABLE prescriptions (
    id               INTEGER PRIMARY KEY,
    consultation_id  INTEGER NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
    patient_id       INTEGER NOT NULL REFERENCES patients(id),
    medicament       TEXT NOT NULL,
    dosage           TEXT,
    posologie        TEXT,
    duree            TEXT,
    instructions     TEXT
  );
  CREATE INDEX idx_prescriptions_patient ON prescriptions(patient_id);

  CREATE TABLE examens (
    id                INTEGER PRIMARY KEY,
    patient_id        INTEGER NOT NULL REFERENCES patients(id),
    consultation_id   INTEGER REFERENCES consultations(id),
    medecin_id        INTEGER NOT NULL REFERENCES users(id),
    etablissement_id  INTEGER REFERENCES etablissements(id),
    type              TEXT NOT NULL,
    libelle           TEXT NOT NULL,
    notes             TEXT,
    statut            TEXT NOT NULL DEFAULT 'demande' CHECK (statut IN ('demande','resultat')),
    resultat          TEXT,
    interpretation    TEXT,
    date_demande      TEXT NOT NULL,
    date_resultat     TEXT,
    resultat_par      INTEGER REFERENCES users(id)
  );
  CREATE INDEX idx_examens_patient ON examens(patient_id);

  CREATE TABLE hospitalisations (
    id                INTEGER PRIMARY KEY,
    patient_id        INTEGER NOT NULL REFERENCES patients(id),
    medecin_id        INTEGER NOT NULL REFERENCES users(id),
    etablissement_id  INTEGER REFERENCES etablissements(id),
    service           TEXT NOT NULL,
    chambre           TEXT,
    lit               TEXT,
    motif             TEXT NOT NULL,
    date_admission    TEXT NOT NULL,
    date_sortie       TEXT,
    mode_sortie       TEXT,
    resume_sortie     TEXT,
    statut            TEXT NOT NULL DEFAULT 'en_cours' CHECK (statut IN ('en_cours','terminee'))
  );
  CREATE INDEX idx_hospitalisations_patient ON hospitalisations(patient_id);

  CREATE TABLE rendez_vous (
    id                INTEGER PRIMARY KEY,
    patient_id        INTEGER NOT NULL REFERENCES patients(id),
    medecin_id        INTEGER REFERENCES users(id),
    etablissement_id  INTEGER REFERENCES etablissements(id),
    date_heure        TEXT NOT NULL,
    motif             TEXT,
    statut            TEXT NOT NULL DEFAULT 'demande' CHECK (statut IN ('demande','confirme','annule','termine')),
    cree_par          INTEGER REFERENCES users(id),
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_rdv_patient ON rendez_vous(patient_id);
  CREATE INDEX idx_rdv_date ON rendez_vous(date_heure);

  -- Journal d'audit : toute lecture/écriture de données de santé est tracée.
  CREATE TABLE audit_log (
    id             INTEGER PRIMARY KEY,
    ts             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    user_id        INTEGER,
    username       TEXT,
    role           TEXT,
    action         TEXT NOT NULL,
    resource_type  TEXT,
    resource_id    TEXT,
    patient_id     INTEGER,
    ip             TEXT,
    details        TEXT
  );
  CREATE INDEX idx_audit_patient ON audit_log(patient_id, ts);
  CREATE INDEX idx_audit_ts ON audit_log(ts);
  `,
  // v2 : rôle « infirmier » et notes de soins infirmiers.
  // SQLite ne permet pas de modifier une contrainte CHECK : la table users est reconstruite.
  `
  CREATE TABLE users_v2 (
    id                    INTEGER PRIMARY KEY,
    username              TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash         TEXT NOT NULL,
    role                  TEXT NOT NULL CHECK (role IN ('admin','medecin','infirmier','patient')),
    nom                   TEXT NOT NULL,
    prenom                TEXT,
    email                 TEXT,
    telephone             TEXT,
    specialite            TEXT,
    numero_ordre          TEXT,
    etablissement_id      INTEGER REFERENCES etablissements(id),
    patient_id            INTEGER UNIQUE REFERENCES patients(id),
    actif                 INTEGER NOT NULL DEFAULT 1,
    must_change_password  INTEGER NOT NULL DEFAULT 1,
    last_login_at         TEXT,
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  INSERT INTO users_v2 SELECT * FROM users;
  DROP TABLE users;
  ALTER TABLE users_v2 RENAME TO users;

  CREATE TABLE soins (
    id                 INTEGER PRIMARY KEY,
    patient_id         INTEGER NOT NULL REFERENCES patients(id),
    auteur_id          INTEGER NOT NULL REFERENCES users(id),
    etablissement_id   INTEGER REFERENCES etablissements(id),
    hospitalisation_id INTEGER REFERENCES hospitalisations(id),
    date               TEXT NOT NULL,
    type               TEXT NOT NULL,
    temperature        REAL,
    tension_sys        INTEGER,
    tension_dia        INTEGER,
    pouls              INTEGER,
    frequence_resp     INTEGER,
    saturation         INTEGER,
    poids              REAL,
    taille             REAL,
    glycemie           REAL,
    note               TEXT,
    created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_soins_patient ON soins(patient_id, date);
  `,
];

export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  if (current >= MIGRATIONS.length) return;
  // Les clés étrangères sont suspendues pendant les migrations (reconstruction de tables),
  // puis vérifiées avant validation de chaque migration.
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    for (let v = current; v < MIGRATIONS.length; v++) {
      tx(db, () => {
        db.exec(MIGRATIONS[v]);
        const broken = db.prepare('PRAGMA foreign_key_check').all();
        if (broken.length) throw new Error(`Migration ${v + 1} : ${broken.length} clé(s) étrangère(s) invalide(s)`);
        db.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Construit un INSERT à partir d'un objet (les clés proviennent toujours d'un schéma validé).
export function insert(db, table, data) {
  const keys = Object.keys(data);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((k) => ':' + k).join(', ')})`;
  return Number(db.prepare(sql).run(data).lastInsertRowid);
}

export function update(db, table, id, data) {
  const keys = Object.keys(data);
  if (!keys.length) return;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = :${k}`).join(', ')} WHERE id = :__id`;
  db.prepare(sql).run({ ...data, __id: id });
}
