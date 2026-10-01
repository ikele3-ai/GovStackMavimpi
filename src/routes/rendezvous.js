import { Router } from 'express';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { SOIGNANTS, STATUTS_RDV } from '../constants.js';
import { insert, update } from '../db.js';
import { HttpError, parseId, validate } from '../validation.js';

const rdvSchema = {
  patient_id: { type: 'integer', min: 1, label: 'Patient' },
  medecin_id: { type: 'integer', min: 1, label: 'Médecin' },
  etablissement_id: { type: 'integer', min: 1, label: 'Établissement' },
  date_heure: { type: 'datetime', required: true, label: 'Date et heure' },
  motif: { type: 'string', max: 300, label: 'Motif' },
};

const rdvUpdateSchema = {
  statut: { type: 'enum', values: STATUTS_RDV, label: 'Statut' },
  date_heure: { type: 'datetime', label: 'Date et heure' },
  medecin_id: { type: 'integer', min: 1, label: 'Médecin' },
};

const SELECT_RDV = `
  SELECT r.*, p.nup, p.nom AS patient_nom, p.postnom AS patient_postnom, p.prenom AS patient_prenom,
         p.telephone AS patient_telephone, u.nom AS medecin_nom, u.prenom AS medecin_prenom,
         e.nom AS etablissement_nom
  FROM rendez_vous r
  JOIN patients p ON p.id = r.patient_id
  LEFT JOIN users u ON u.id = r.medecin_id
  LEFT JOIN etablissements e ON e.id = r.etablissement_id`;

export function rendezVousRouter(db) {
  const r = Router();
  const autorises = requireRole(...SOIGNANTS, 'patient');

  const getMedecin = (id) => {
    const m = db.prepare("SELECT id, etablissement_id FROM users WHERE id = ? AND role = 'medecin' AND actif = 1").get(id);
    if (!m) throw new HttpError(400, 'Médecin introuvable');
    return m;
  };

  r.get('/', autorises, (req, res) => {
    const du = typeof req.query.du === 'string' && req.query.du ? req.query.du : null;
    const au = typeof req.query.au === 'string' && req.query.au ? req.query.au : null;
    if (req.user.role === 'patient') {
      return res.json(db.prepare(`${SELECT_RDV} WHERE r.patient_id = ? ORDER BY r.date_heure DESC`).all(req.user.patient_id));
    }
    // Médecin : ses rendez-vous + ceux de son établissement non encore attribués.
    // Infirmier : tous les rendez-vous de son établissement (gestion de l'accueil).
    const rows = db.prepare(`${SELECT_RDV}
      WHERE (r.medecin_id = :me OR (r.medecin_id IS NULL AND r.etablissement_id IS :etab)
             OR (:tous = 1 AND r.etablissement_id IS :etab))
        AND (:du IS NULL OR r.date_heure >= :du) AND (:au IS NULL OR r.date_heure < :au)
      ORDER BY r.date_heure`).all({
      me: req.user.id, etab: req.user.etablissement_id ?? null, tous: req.query.tous === '1' || req.user.role === 'infirmier' ? 1 : 0, du, au,
    });
    res.json(rows);
  });

  r.post('/', autorises, (req, res) => {
    const data = validate(req.body, rdvSchema);
    let row;
    if (req.user.role === 'patient') {
      // Le patient formule une demande pour lui-même, qui sera confirmée par le médecin.
      if (Date.parse(data.date_heure) < Date.now()) throw new HttpError(400, 'La date doit être dans le futur');
      const med = data.medecin_id ? getMedecin(data.medecin_id) : null;
      const etab = med ? med.etablissement_id : data.etablissement_id;
      if (!etab || !db.prepare('SELECT 1 FROM etablissements WHERE id = ?').get(etab)) {
        throw new HttpError(400, 'Choisissez un médecin ou un établissement');
      }
      row = { patient_id: req.user.patient_id, medecin_id: med?.id ?? null, etablissement_id: etab, statut: 'demande' };
    } else {
      if (!data.patient_id || !db.prepare('SELECT 1 FROM patients WHERE id = ?').get(data.patient_id)) {
        throw new HttpError(400, 'Patient introuvable');
      }
      // Sans médecin précisé : le médecin connecté, ou « non attribué » si c'est un infirmier.
      const med = data.medecin_id ? getMedecin(data.medecin_id)
        : req.user.role === 'medecin' ? { id: req.user.id, etablissement_id: req.user.etablissement_id }
          : { id: null, etablissement_id: req.user.etablissement_id };
      row = { patient_id: data.patient_id, medecin_id: med.id, etablissement_id: med.etablissement_id ?? null, statut: 'confirme' };
    }
    const id = insert(db, 'rendez_vous', {
      ...row, date_heure: data.date_heure, motif: data.motif ?? null, cree_par: req.user.id,
    });
    audit(db, req, 'CREATION_RDV', { type: 'rendez_vous', id, patientId: row.patient_id });
    res.status(201).json(db.prepare(`${SELECT_RDV} WHERE r.id = ?`).get(id));
  });

  r.patch('/:id', autorises, (req, res) => {
    const id = parseId(req.params.id);
    const rdv = db.prepare('SELECT * FROM rendez_vous WHERE id = ?').get(id);
    if (!rdv) throw new HttpError(404, 'Rendez-vous introuvable');
    const data = validate(req.body, rdvUpdateSchema, { partial: true });
    if (req.user.role === 'patient') {
      // Le patient peut uniquement annuler son propre rendez-vous.
      if (rdv.patient_id !== req.user.patient_id) throw new HttpError(403, 'Accès refusé');
      if (Object.keys(data).length !== 1 || data.statut !== 'annule') {
        throw new HttpError(403, 'Vous pouvez uniquement annuler un rendez-vous');
      }
      if (!['demande', 'confirme'].includes(rdv.statut)) throw new HttpError(409, 'Ce rendez-vous ne peut plus être annulé');
    } else if (data.medecin_id) {
      data.etablissement_id = getMedecin(data.medecin_id).etablissement_id;
    }
    update(db, 'rendez_vous', id, data);
    audit(db, req, 'MODIFICATION_RDV', { type: 'rendez_vous', id, patientId: rdv.patient_id, details: data });
    res.json(db.prepare(`${SELECT_RDV} WHERE r.id = ?`).get(id));
  });

  return r;
}
