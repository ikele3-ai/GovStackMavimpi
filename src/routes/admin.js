import { Router } from 'express';
import { destroyUserSessions, generateTempPassword, hashPassword, PUBLIC_USER_FIELDS, requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { TYPES_ETABLISSEMENT, PROVINCES } from '../constants.js';
import { insert, update } from '../db.js';
import { HttpError, parseId, validate } from '../validation.js';

const etablissementSchema = {
  code: { type: 'string', required: true, max: 30, label: 'Code', pattern: /^[A-Za-z0-9_-]+$/ },
  nom: { type: 'string', required: true, max: 200, label: 'Nom' },
  type: { type: 'enum', required: true, values: TYPES_ETABLISSEMENT, label: 'Type' },
  province: { type: 'enum', required: true, values: PROVINCES, label: 'Province' },
  zone_sante: { type: 'string', max: 100, label: 'Zone de santé' },
  adresse: { type: 'string', max: 300, label: 'Adresse' },
  telephone: { type: 'string', max: 30, label: 'Téléphone' },
};

const staffSchema = {
  username: { type: 'string', required: true, min: 3, max: 50, pattern: /^[A-Za-z0-9._-]+$/, label: 'Identifiant' },
  role: { type: 'enum', required: true, values: ['admin', 'medecin', 'infirmier'], label: 'Rôle' },
  nom: { type: 'string', required: true, max: 100, label: 'Nom' },
  prenom: { type: 'string', max: 100, label: 'Prénom' },
  email: { type: 'email', max: 200, label: 'E-mail' },
  telephone: { type: 'string', max: 30, label: 'Téléphone' },
  specialite: { type: 'string', max: 100, label: 'Spécialité' },
  numero_ordre: { type: 'string', max: 50, label: "N° d'ordre professionnel" },
  etablissement_id: { type: 'integer', min: 1, label: 'Établissement' },
};

const staffUpdateSchema = {
  nom: staffSchema.nom,
  prenom: staffSchema.prenom,
  email: staffSchema.email,
  telephone: staffSchema.telephone,
  specialite: staffSchema.specialite,
  numero_ordre: staffSchema.numero_ordre,
  etablissement_id: staffSchema.etablissement_id,
  actif: { type: 'boolean', label: 'Actif' },
};

export function adminRouter(db) {
  const r = Router();

  // --- Établissements (lecture pour tous les utilisateurs connectés) ---
  r.get('/etablissements', (req, res) => {
    res.json(db.prepare('SELECT * FROM etablissements ORDER BY nom').all());
  });

  r.post('/etablissements', requireRole('admin'), (req, res) => {
    const data = validate(req.body, etablissementSchema);
    data.code = data.code.toUpperCase();
    if (db.prepare('SELECT 1 FROM etablissements WHERE code = ?').get(data.code)) {
      throw new HttpError(409, 'Ce code d\'établissement existe déjà');
    }
    const id = insert(db, 'etablissements', data);
    audit(db, req, 'CREATION_ETABLISSEMENT', { type: 'etablissement', id });
    res.status(201).json(db.prepare('SELECT * FROM etablissements WHERE id = ?').get(id));
  });

  r.patch('/etablissements/:id', requireRole('admin'), (req, res) => {
    const id = parseId(req.params.id);
    if (!db.prepare('SELECT 1 FROM etablissements WHERE id = ?').get(id)) throw new HttpError(404, 'Établissement introuvable');
    const { code, ...schema } = etablissementSchema;
    update(db, 'etablissements', id, validate(req.body, schema, { partial: true }));
    audit(db, req, 'MODIFICATION_ETABLISSEMENT', { type: 'etablissement', id });
    res.json(db.prepare('SELECT * FROM etablissements WHERE id = ?').get(id));
  });

  // --- Médecins (liste visible par les médecins et patients pour les rendez-vous) ---
  r.get('/medecins', (req, res) => {
    res.json(db.prepare(`
      SELECT u.id, u.nom, u.prenom, u.specialite, u.etablissement_id, e.nom AS etablissement_nom
      FROM users u LEFT JOIN etablissements e ON e.id = u.etablissement_id
      WHERE u.role = 'medecin' AND u.actif = 1 ORDER BY u.nom, u.prenom`).all());
  });

  // --- Comptes du personnel (admin uniquement) ---
  r.get('/users', requireRole('admin'), (req, res) => {
    const role = typeof req.query.role === 'string' ? req.query.role : null;
    const rows = db.prepare(`
      SELECT ${PUBLIC_USER_FIELDS}, e.nom AS etablissement_nom, p.nup AS patient_nup
      FROM users u
      LEFT JOIN etablissements e ON e.id = u.etablissement_id
      LEFT JOIN patients p ON p.id = u.patient_id
      WHERE (:role IS NULL OR u.role = :role)
      ORDER BY u.role, u.nom`).all({ role });
    res.json(rows);
  });

  r.post('/users', requireRole('admin'), async (req, res) => {
    const data = validate(req.body, staffSchema);
    if (data.role !== 'admin' && !data.etablissement_id) {
      throw new HttpError(400, 'Données invalides', ['Le personnel soignant doit être rattaché à un établissement']);
    }
    if (data.etablissement_id && !db.prepare('SELECT 1 FROM etablissements WHERE id = ?').get(data.etablissement_id)) {
      throw new HttpError(400, 'Établissement introuvable');
    }
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(data.username)) {
      throw new HttpError(409, 'Cet identifiant est déjà utilisé');
    }
    const tempPassword = generateTempPassword();
    const id = insert(db, 'users', { ...data, password_hash: await hashPassword(tempPassword), must_change_password: 1 });
    audit(db, req, 'CREATION_UTILISATEUR', { type: 'user', id, details: { role: data.role } });
    res.status(201).json({ id, username: data.username, temp_password: tempPassword });
  });

  r.patch('/users/:id', requireRole('admin'), (req, res) => {
    const id = parseId(req.params.id);
    const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
    if (!target) throw new HttpError(404, 'Utilisateur introuvable');
    const data = validate(req.body, staffUpdateSchema, { partial: true });
    if (id === req.user.id && data.actif === 0) throw new HttpError(400, 'Vous ne pouvez pas désactiver votre propre compte');
    update(db, 'users', id, data);
    if (data.actif === 0) destroyUserSessions(db, id);
    audit(db, req, 'MODIFICATION_UTILISATEUR', { type: 'user', id, details: Object.keys(data) });
    res.json({ ok: true });
  });

  r.post('/users/:id/reset-password', requireRole('admin'), async (req, res) => {
    const id = parseId(req.params.id);
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) throw new HttpError(404, 'Utilisateur introuvable');
    const tempPassword = generateTempPassword();
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(await hashPassword(tempPassword), id);
    destroyUserSessions(db, id);
    audit(db, req, 'REINITIALISATION_MOT_DE_PASSE', { type: 'user', id });
    res.json({ temp_password: tempPassword });
  });

  // --- Journal d'audit ---
  r.get('/audit', requireRole('admin'), (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const action = typeof req.query.action === 'string' && req.query.action ? req.query.action : null;
    const rows = db.prepare(`
      SELECT a.*, p.nup AS patient_nup FROM audit_log a LEFT JOIN patients p ON p.id = a.patient_id
      WHERE (:action IS NULL OR a.action = :action)
      ORDER BY a.id DESC LIMIT :limit OFFSET :offset`).all({ action, limit, offset });
    res.json(rows);
  });

  return r;
}
