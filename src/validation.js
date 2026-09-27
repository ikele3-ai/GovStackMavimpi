export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Valide `body` selon `schema` et renvoie uniquement les champs connus.
 * Règles : { type, required, max, min, values, label }
 * Types : string, text, email, number, integer, date, datetime, enum, boolean
 * Avec `partial`, les champs absents sont ignorés (mise à jour partielle).
 */
export function validate(body, schema, { partial = false } = {}) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Corps de requête JSON attendu');
  }
  const out = {};
  const errors = [];
  for (const [key, rule] of Object.entries(schema)) {
    const label = rule.label || key;
    let v = body[key];
    if (v === undefined) {
      if (!partial && rule.required) errors.push(`${label} est obligatoire`);
      continue;
    }
    if (v === null || (typeof v === 'string' && v.trim() === '')) {
      if (rule.required) errors.push(`${label} est obligatoire`);
      else out[key] = null;
      continue;
    }
    switch (rule.type) {
      case 'string':
      case 'text':
      case 'email': {
        if (typeof v !== 'string' && typeof v !== 'number') { errors.push(`${label} doit être un texte`); continue; }
        v = String(v).trim();
        const max = rule.max ?? (rule.type === 'text' ? 10000 : 200);
        if (v.length > max) { errors.push(`${label} : ${max} caractères maximum`); continue; }
        if (rule.min && v.length < rule.min) { errors.push(`${label} : ${rule.min} caractères minimum`); continue; }
        if (rule.type === 'email' && !EMAIL_RE.test(v)) { errors.push(`${label} : adresse e-mail invalide`); continue; }
        if (rule.pattern && !rule.pattern.test(v)) { errors.push(`${label} : format invalide`); continue; }
        break;
      }
      case 'number':
      case 'integer': {
        v = Number(v);
        if (!Number.isFinite(v) || (rule.type === 'integer' && !Number.isInteger(v))) {
          errors.push(`${label} doit être un nombre${rule.type === 'integer' ? ' entier' : ''}`); continue;
        }
        if (rule.min !== undefined && v < rule.min) { errors.push(`${label} doit être ≥ ${rule.min}`); continue; }
        if (rule.max !== undefined && v > rule.max) { errors.push(`${label} doit être ≤ ${rule.max}`); continue; }
        break;
      }
      case 'date': {
        if (typeof v !== 'string' || !DATE_RE.test(v) || Number.isNaN(Date.parse(v))) {
          errors.push(`${label} : date invalide (AAAA-MM-JJ)`); continue;
        }
        if (rule.notFuture && v > new Date().toISOString().slice(0, 10)) {
          errors.push(`${label} ne peut pas être dans le futur`); continue;
        }
        break;
      }
      case 'datetime': {
        if (typeof v !== 'string' || !DATETIME_RE.test(v) || Number.isNaN(Date.parse(v))) {
          errors.push(`${label} : date/heure invalide`); continue;
        }
        break;
      }
      case 'enum': {
        if (!rule.values.includes(v)) { errors.push(`${label} : valeur non autorisée`); continue; }
        break;
      }
      case 'boolean': {
        if (typeof v !== 'boolean') { errors.push(`${label} doit être vrai ou faux`); continue; }
        v = v ? 1 : 0;
        break;
      }
      default:
        throw new Error(`Type de règle inconnu : ${rule.type}`);
    }
    out[key] = v;
  }
  if (errors.length) throw new HttpError(400, 'Données invalides', errors);
  return out;
}

export function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Identifiant invalide');
  return id;
}
