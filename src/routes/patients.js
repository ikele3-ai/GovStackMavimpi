import { Router } from 'express';
import { destroyUserSessions, generateTempPassword, hashPassword, requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { config } from '../config.js';
import {
  ETATS_CIVILS, GROUPES_SANGUINS, MODES_SORTIE, PROVINCES, SEXES, SOIGNANTS, TYPES_EXAMEN, TYPES_SOIN,
} from '../constants.js';
import { insert, tx, update } from '../db.js';
import { HttpError, parseId, validate } from '../validation.js';

export const patientSchema = {
  nom: { type: 'string', required: true, max: 100, label: 'Nom' },
  postnom: { type: 'string', max: 100, label: 'Postnom' },
  prenom: { type: 'string', max: 100, label: 'Prénom' },
  sexe: { type: 'enum', required: true, values: SEXES, label: 'Sexe' },
  date_naissance: { type: 'date', notFuture: true, label: 'Date de naissance' },
  lieu_naissance: { type: 'string', max: 100, label: 'Lieu de naissance' },
  telephone: { type: 'string', max: 30, pattern: /^[+0-9 ()-]{6,30}$/, label: 'Téléphone' },
  email: { type: 'email', max: 200, label: 'E-mail' },
  province: { type: 'enum', values: PROVINCES, label: 'Province' },
  ville: { type: 'string', max: 100, label: 'Ville' },
  commune: { type: 'string', max: 100, label: 'Commune' },
  quartier: { type: 'string', max: 100, label: 'Quartier' },
  adresse: { type: 'string', max: 300, label: 'Adresse' },
  profession: { type: 'string', max: 100, label: 'Profession' },
  etat_civil: { type: 'enum', values: ETATS_CIVILS, label: 'État civil' },
  groupe_sanguin: { type: 'enum', values: GROUPES_SANGUINS, label: 'Groupe sanguin' },
  allergies: { type: 'text', max: 2000, label: 'Allergies' },
  antecedents: { type: 'text', max: 5000, label: 'Antécédents' },
  maladies_chroniques: { type: 'text', max: 2000, label: 'Maladies chroniques' },
  contact_urgence_nom: { type: 'string', max: 150, label: "Contact d'urgence" },
  contact_urgence_tel: { type: 'string', max: 30, label: "Téléphone du contact d'urgence" },
  contact_urgence_lien: { type: 'string', max: 50, label: 'Lien de parenté' },
  assurance: { type: 'string', max: 150, label: 'Assurance / mutuelle' },
};

const prescriptionSchema = {
  medicament: { type: 'string', required: true, max: 200, label: 'Médicament' },
  dosage: { type: 'string', max: 100, label: 'Dosage' },
  posologie: { type: 'string', max: 200, label: 'Posologie' },
  duree: { type: 'string', max: 100, label: 'Durée' },
  instructions: { type: 'string', max: 500, label: 'Instructions' },
};

const consultationSchema = {
  date: { type: 'datetime', label: 'Date' },
  motif: { type: 'string', required: true, max: 300, label: 'Motif' },
  symptomes: { type: 'text', max: 5000, label: 'Symptômes' },
  temperature: { type: 'number', min: 30, max: 45, label: 'Température (°C)' },
  tension_sys: { type: 'integer', min: 40, max: 300, label: 'Tension systolique' },
  tension_dia: { type: 'integer', min: 20, max: 200, label: 'Tension diastolique' },
  pouls: { type: 'integer', min: 20, max: 250, label: 'Pouls' },
  frequence_resp: { type: 'integer', min: 5, max: 80, label: 'Fréquence respiratoire' },
  poids: { type: 'number', min: 0.3, max: 400, label: 'Poids (kg)' },
  taille: { type: 'number', min: 20, max: 250, label: 'Taille (cm)' },
  saturation: { type: 'integer', min: 50, max: 100, label: 'Saturation O₂ (%)' },
  examen_clinique: { type: 'text', max: 5000, label: 'Examen clinique' },
  diagnostic: { type: 'text', max: 2000, label: 'Diagnostic' },
  code_cim10: { type: 'string', max: 10, pattern: /^[A-Za-z][0-9]{2}(\.[0-9A-Za-z]{1,4})?$/, label: 'Code CIM-10' },
  traitement: { type: 'text', max: 5000, label: 'Traitement' },
  recommandations: { type: 'text', max: 5000, label: 'Recommandations' },
};

const examenSchema = {
  type: { type: 'enum', required: true, values: TYPES_EXAMEN, label: "Type d'examen" },
  libelle: { type: 'string', required: true, max: 200, label: 'Examen' },
  notes: { type: 'text', max: 2000, label: 'Notes' },
  consultation_id: { type: 'integer', min: 1, label: 'Consultation' },
};

const resultatSchema = {
  resultat: { type: 'text', required: true, max: 10000, label: 'Résultat' },
  interpretation: { type: 'text', max: 5000, label: 'Interprétation' },
};

const soinSchema = {
  date: { type: 'datetime', label: 'Date' },
  type: { type: 'enum', required: true, values: TYPES_SOIN, label: 'Type de soin' },
  temperature: consultationSchema.temperature,
  tension_sys: consultationSchema.tension_sys,
  tension_dia: consultationSchema.tension_dia,
  pouls: consultationSchema.pouls,
  frequence_resp: consultationSchema.frequence_resp,
  saturation: consultationSchema.saturation,
  poids: consultationSchema.poids,
  taille: consultationSchema.taille,
  glycemie: { type: 'number', min: 0.1, max: 40, label: 'Glycémie (mmol/L)' },
  note: { type: 'text', max: 5000, label: 'Note de soins' },
};

const hospitalisationSchema = {
  service: { type: 'string', required: true, max: 100, label: 'Service' },
  chambre: { type: 'string', max: 20, label: 'Chambre' },
  lit: { type: 'string', max: 20, label: 'Lit' },
  motif: { type: 'string', required: true, max: 500, label: "Motif d'admission" },
  date_admission: { type: 'datetime', label: "Date d'admission" },
};

const sortieSchema = {
  date_sortie: { type: 'datetime', label: 'Date de sortie' },
  mode_sortie: { type: 'enum', required: true, values: MODES_SORTIE, label: 'Mode de sortie' },
  resume_sortie: { type: 'text', max: 10000, label: 'Résumé de sortie' },
};

// Chiffre de contrôle Luhn : détecte les erreurs de saisie du NUP.
function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

export function makeNup(id, year = new Date().getFullYear()) {
  const num = String(id).padStart(6, '0');
  return `${config.nupPrefix}-${year}-${num}-${luhn(`${year}${num}`)}`;
}

const nowIso = () => new Date().toISOString();

/** Le personnel soignant accède à toutes les fiches (accès tracé) ; un patient uniquement à la sienne. */
export function assertCanRead(req, patientId) {
  const u = req.user;
  if (SOIGNANTS.includes(u.role)) return;
  if (u.role === 'patient' && u.patient_id === patientId) return;
  throw new HttpError(403, 'Accès refusé à ce dossier');
}

export function getPatientOr404(db, id) {
  const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(id);
  if (!p) throw new HttpError(404, 'Patient introuvable');
  return p;
}

export function loadFullRecord(db, patientId) {
  const patient = db.prepare(`
    SELECT p.*, e.nom AS etablissement_nom FROM patients p
    LEFT JOIN etablissements e ON e.id = p.etablissement_id WHERE p.id = ?`).get(patientId);
  const consultations = db.prepare(`
    SELECT c.*, u.nom AS medecin_nom, u.prenom AS medecin_prenom, u.specialite AS medecin_specialite,
           e.nom AS etablissement_nom
    FROM consultations c JOIN users u ON u.id = c.medecin_id
    LEFT JOIN etablissements e ON e.id = c.etablissement_id
    WHERE c.patient_id = ? ORDER BY c.date DESC, c.id DESC`).all(patientId);
  const prescriptions = db.prepare('SELECT * FROM prescriptions WHERE patient_id = ? ORDER BY id').all(patientId);
  for (const c of consultations) c.prescriptions = prescriptions.filter((p) => p.consultation_id === c.id);
  const examens = db.prepare(`
    SELECT x.*, u.nom AS medecin_nom, u.prenom AS medecin_prenom, e.nom AS etablissement_nom
    FROM examens x JOIN users u ON u.id = x.medecin_id
    LEFT JOIN etablissements e ON e.id = x.etablissement_id
    WHERE x.patient_id = ? ORDER BY x.date_demande DESC, x.id DESC`).all(patientId);
  const hospitalisations = db.prepare(`
    SELECT h.*, u.nom AS medecin_nom, u.prenom AS medecin_prenom, e.nom AS etablissement_nom
    FROM hospitalisations h JOIN users u ON u.id = h.medecin_id
    LEFT JOIN etablissements e ON e.id = h.etablissement_id
    WHERE h.patient_id = ? ORDER BY h.date_admission DESC, h.id DESC`).all(patientId);
  const rendez_vous = db.prepare(`
    SELECT r.*, u.nom AS medecin_nom, u.prenom AS medecin_prenom, e.nom AS etablissement_nom
    FROM rendez_vous r LEFT JOIN users u ON u.id = r.medecin_id
    LEFT JOIN etablissements e ON e.id = r.etablissement_id
    WHERE r.patient_id = ? ORDER BY r.date_heure DESC`).all(patientId);
  const soins = db.prepare(`
    SELECT s.*, u.nom AS auteur_nom, u.prenom AS auteur_prenom, u.role AS auteur_role, e.nom AS etablissement_nom
    FROM soins s JOIN users u ON u.id = s.auteur_id
    LEFT JOIN etablissements e ON e.id = s.etablissement_id
    WHERE s.patient_id = ? ORDER BY s.date DESC, s.id DESC`).all(patientId);
  const compte = db.prepare('SELECT username, actif, last_login_at FROM users WHERE patient_id = ?').get(patientId) || null;
  return { patient, consultations, soins, examens, hospitalisations, rendez_vous, compte };
}

export function patientsRouter(db) {
  const r = Router();
  // Diagnostic, prescription, examens, hospitalisation, accès patient : médecin uniquement.
  const medecin = requireRole('medecin');
  // Accueil, fiche, soins infirmiers : tout le personnel soignant.
  const soignant = requireRole(...SOIGNANTS);

  // Recherche de patients (nom, postnom, prénom, NUP, téléphone)
  r.get('/', soignant, (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const like = `%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
    const rows = db.prepare(`
      SELECT p.id, p.nup, p.nom, p.postnom, p.prenom, p.sexe, p.date_naissance, p.telephone, p.province, p.ville,
             (SELECT MAX(date) FROM consultations c WHERE c.patient_id = p.id) AS derniere_consultation,
             EXISTS (SELECT 1 FROM hospitalisations h WHERE h.patient_id = p.id AND h.statut = 'en_cours') AS hospitalise
      FROM patients p
      WHERE :q = '' OR p.nup LIKE :like ESCAPE '\\' OR p.telephone LIKE :like ESCAPE '\\'
         OR (p.nom || ' ' || IFNULL(p.postnom,'') || ' ' || IFNULL(p.prenom,'')) LIKE :like ESCAPE '\\'
         OR (IFNULL(p.prenom,'') || ' ' || p.nom || ' ' || IFNULL(p.postnom,'')) LIKE :like ESCAPE '\\'
      ORDER BY p.updated_at DESC LIMIT 50`).all({ q, like });
    if (q) audit(db, req, 'RECHERCHE_PATIENT', { details: { q } });
    res.json(rows);
  });

  // Création d'une fiche patient
  r.post('/', soignant, (req, res) => {
    const data = validate(req.body, patientSchema);
    if (req.body.confirmer_doublon !== true) {
      const doublons = db.prepare(`
        SELECT nup, nom, postnom, prenom, date_naissance FROM patients
        WHERE nom = ? COLLATE NOCASE AND IFNULL(postnom,'') = ? COLLATE NOCASE AND IFNULL(prenom,'') = ? COLLATE NOCASE
          AND (? IS NULL OR date_naissance IS NULL OR date_naissance = ?)`)
        .all(data.nom, data.postnom || '', data.prenom || '', data.date_naissance ?? null, data.date_naissance ?? null);
      if (doublons.length) {
        throw new HttpError(409, 'Un patient portant ce nom existe déjà. Vérifiez avant de créer un doublon.', doublons);
      }
    }
    const id = tx(db, () => {
      const newId = insert(db, 'patients', {
        ...data,
        nup: `TMP-${Date.now()}-${Math.random()}`,
        etablissement_id: req.user.etablissement_id ?? null,
        created_by: req.user.id,
      });
      db.prepare('UPDATE patients SET nup = ? WHERE id = ?').run(makeNup(newId), newId);
      return newId;
    });
    audit(db, req, 'CREATION_FICHE', { type: 'patient', id, patientId: id });
    res.status(201).json(db.prepare('SELECT * FROM patients WHERE id = ?').get(id));
  });

  // Fiche complète (médecin, ou le patient lui-même)
  r.get('/:id', (req, res) => {
    const id = parseId(req.params.id);
    assertCanRead(req, id);
    getPatientOr404(db, id);
    audit(db, req, 'LECTURE_FICHE', { type: 'patient', id, patientId: id });
    res.json(loadFullRecord(db, id));
  });

  r.patch('/:id', soignant, (req, res) => {
    const id = parseId(req.params.id);
    getPatientOr404(db, id);
    const data = validate(req.body, patientSchema, { partial: true });
    update(db, 'patients', id, { ...data, updated_at: nowIso() });
    audit(db, req, 'MODIFICATION_FICHE', { type: 'patient', id, patientId: id, details: Object.keys(data) });
    res.json(db.prepare('SELECT * FROM patients WHERE id = ?').get(id));
  });

  // Création / réinitialisation du compte d'accès du patient (identifiant = NUP)
  r.post('/:id/compte', medecin, async (req, res) => {
    const id = parseId(req.params.id);
    const p = getPatientOr404(db, id);
    const tempPassword = generateTempPassword();
    const hash = await hashPassword(tempPassword);
    const existing = db.prepare('SELECT id FROM users WHERE patient_id = ?').get(id);
    if (existing) {
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, actif = 1 WHERE id = ?').run(hash, existing.id);
      destroyUserSessions(db, existing.id);
      audit(db, req, 'REINITIALISATION_COMPTE_PATIENT', { type: 'user', id: existing.id, patientId: id });
    } else {
      const uid = insert(db, 'users', {
        username: p.nup, password_hash: hash, role: 'patient', nom: p.nom,
        prenom: p.prenom, telephone: p.telephone, email: p.email, patient_id: id, must_change_password: 1,
      });
      audit(db, req, 'CREATION_COMPTE_PATIENT', { type: 'user', id: uid, patientId: id });
    }
    res.status(existing ? 200 : 201).json({ username: p.nup, temp_password: tempPassword });
  });

  // Qui a consulté ce dossier ? (visible par le patient : transparence)
  r.get('/:id/acces', (req, res) => {
    const id = parseId(req.params.id);
    assertCanRead(req, id);
    getPatientOr404(db, id);
    const rows = db.prepare(`
      SELECT a.id, a.ts, a.action, a.role, u.nom, u.prenom, u.specialite, e.nom AS etablissement_nom
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.user_id
      LEFT JOIN etablissements e ON e.id = u.etablissement_id
      WHERE a.patient_id = ? ORDER BY a.id DESC LIMIT 500`).all(id);
    res.json(rows);
  });

  // --- Consultations ---
  r.post('/:id/consultations', medecin, (req, res) => {
    const patientId = parseId(req.params.id);
    getPatientOr404(db, patientId);
    const data = validate(req.body, consultationSchema);
    const prescriptions = Array.isArray(req.body.prescriptions) ? req.body.prescriptions : [];
    if (prescriptions.length > 30) throw new HttpError(400, 'Trop de prescriptions (30 maximum)');
    const rx = prescriptions
      .filter((p) => p && typeof p === 'object' && String(p.medicament ?? '').trim())
      .map((p) => validate(p, prescriptionSchema));
    if (data.code_cim10) data.code_cim10 = data.code_cim10.toUpperCase();
    const id = tx(db, () => {
      const cid = insert(db, 'consultations', {
        ...data,
        date: data.date || nowIso(),
        patient_id: patientId,
        medecin_id: req.user.id,
        etablissement_id: req.user.etablissement_id ?? null,
      });
      for (const p of rx) insert(db, 'prescriptions', { ...p, consultation_id: cid, patient_id: patientId });
      db.prepare('UPDATE patients SET updated_at = ? WHERE id = ?').run(nowIso(), patientId);
      return cid;
    });
    audit(db, req, 'AJOUT_CONSULTATION', { type: 'consultation', id, patientId });
    res.status(201).json({ id });
  });

  // --- Soins infirmiers (signes vitaux, notes de soins) ---
  r.post('/:id/soins', soignant, (req, res) => {
    const patientId = parseId(req.params.id);
    getPatientOr404(db, patientId);
    const data = validate(req.body, soinSchema);
    const hosp = db.prepare("SELECT id FROM hospitalisations WHERE patient_id = ? AND statut = 'en_cours'").get(patientId);
    const id = insert(db, 'soins', {
      ...data,
      date: data.date || nowIso(),
      patient_id: patientId,
      auteur_id: req.user.id,
      etablissement_id: req.user.etablissement_id ?? null,
      hospitalisation_id: hosp?.id ?? null,
    });
    db.prepare('UPDATE patients SET updated_at = ? WHERE id = ?').run(nowIso(), patientId);
    audit(db, req, 'AJOUT_SOIN', { type: 'soin', id, patientId });
    res.status(201).json({ id });
  });

  // --- Examens ---
  r.post('/:id/examens', medecin, (req, res) => {
    const patientId = parseId(req.params.id);
    getPatientOr404(db, patientId);
    const data = validate(req.body, examenSchema);
    if (data.consultation_id &&
        !db.prepare('SELECT 1 FROM consultations WHERE id = ? AND patient_id = ?').get(data.consultation_id, patientId)) {
      throw new HttpError(400, 'Consultation introuvable pour ce patient');
    }
    const id = insert(db, 'examens', {
      ...data, patient_id: patientId, medecin_id: req.user.id,
      etablissement_id: req.user.etablissement_id ?? null, date_demande: nowIso(),
    });
    audit(db, req, 'DEMANDE_EXAMEN', { type: 'examen', id, patientId });
    res.status(201).json({ id });
  });

  // --- Hospitalisations ---
  r.post('/:id/hospitalisations', medecin, (req, res) => {
    const patientId = parseId(req.params.id);
    getPatientOr404(db, patientId);
    if (db.prepare("SELECT 1 FROM hospitalisations WHERE patient_id = ? AND statut = 'en_cours'").get(patientId)) {
      throw new HttpError(409, 'Ce patient est déjà hospitalisé');
    }
    const data = validate(req.body, hospitalisationSchema);
    const id = insert(db, 'hospitalisations', {
      ...data, date_admission: data.date_admission || nowIso(), patient_id: patientId,
      medecin_id: req.user.id, etablissement_id: req.user.etablissement_id ?? null,
    });
    audit(db, req, 'ADMISSION', { type: 'hospitalisation', id, patientId });
    res.status(201).json({ id });
  });

  return r;
}

// Routes agissant directement sur un examen / une hospitalisation.
export function soinsRouter(db) {
  const r = Router();
  const medecin = requireRole('medecin');

  r.patch('/examens/:id/resultat', requireRole(...SOIGNANTS), (req, res) => {
    const id = parseId(req.params.id);
    const ex = db.prepare('SELECT * FROM examens WHERE id = ?').get(id);
    if (!ex) throw new HttpError(404, 'Examen introuvable');
    const data = validate(req.body, resultatSchema);
    update(db, 'examens', id, { ...data, statut: 'resultat', date_resultat: nowIso(), resultat_par: req.user.id });
    audit(db, req, 'RESULTAT_EXAMEN', { type: 'examen', id, patientId: ex.patient_id });
    res.json({ ok: true });
  });

  r.patch('/hospitalisations/:id/sortie', medecin, (req, res) => {
    const id = parseId(req.params.id);
    const h = db.prepare('SELECT * FROM hospitalisations WHERE id = ?').get(id);
    if (!h) throw new HttpError(404, 'Hospitalisation introuvable');
    if (h.statut !== 'en_cours') throw new HttpError(409, 'Cette hospitalisation est déjà clôturée');
    const data = validate(req.body, sortieSchema);
    const dateSortie = data.date_sortie || nowIso();
    if (Date.parse(dateSortie) < Date.parse(h.date_admission)) {
      throw new HttpError(400, "La date de sortie ne peut pas précéder la date d'admission");
    }
    update(db, 'hospitalisations', id, { ...data, date_sortie: dateSortie, statut: 'terminee' });
    audit(db, req, 'SORTIE', { type: 'hospitalisation', id, patientId: h.patient_id });
    res.json({ ok: true });
  });

  return r;
}
