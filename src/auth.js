import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import { HttpError } from './validation.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEYLEN = 64;

export const SESSION_COOKIE = 'sid';

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [algo, n, saltB64, hashB64] = String(stored).split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { ...SCRYPT_PARAMS, N: Number(n) });
  return crypto.timingSafeEqual(expected, actual);
}

// Mot de passe fort : 8 caractères minimum, avec lettres et chiffres.
export function checkPasswordPolicy(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new HttpError(400, 'Le mot de passe doit contenir entre 8 et 128 caractères');
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new HttpError(400, 'Le mot de passe doit contenir au moins une lettre et un chiffre');
  }
}

// Mot de passe temporaire lisible (sans caractères ambigus), communiqué au patient/médecin.
export function generateTempPassword() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(10);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  // Garantit la présence d'au moins un chiffre pour respecter la politique.
  return out.slice(0, 9) + String(bytes[9] % 8 + 2);
}

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function createSession(db, userId, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionTtlHours * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)')
    .run(hashToken(token), userId, expires, req.ip || null, String(req.get('user-agent') || '').slice(0, 300));
  // Nettoyage opportuniste des sessions expirées
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  return { token, expires };
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function destroyUserSessions(db, userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function setSessionCookie(res, token, expires) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    expires: new Date(expires),
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/' });
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1 && part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export function getRequestToken(req) {
  const auth = req.get('authorization');
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return readCookie(req, SESSION_COOKIE);
}

export const PUBLIC_USER_FIELDS =
  'u.id, u.username, u.role, u.nom, u.prenom, u.email, u.telephone, u.specialite, u.numero_ordre, ' +
  'u.etablissement_id, u.patient_id, u.actif, u.must_change_password, u.last_login_at, u.created_at';

// Charge l'utilisateur de la session (ou renvoie 401).
export function authenticate(db) {
  const stmt = db.prepare(`
    SELECT ${PUBLIC_USER_FIELDS}, e.nom AS etablissement_nom
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN etablissements e ON e.id = u.etablissement_id
    WHERE s.token_hash = ? AND s.expires_at > ?`);
  return (req, res, next) => {
    const token = getRequestToken(req);
    const user = token ? stmt.get(hashToken(token), new Date().toISOString()) : null;
    if (!user || !user.actif) return next(new HttpError(401, 'Authentification requise'));
    req.user = user;
    req.sessionToken = token;
    // Un mot de passe temporaire doit être changé avant toute autre action.
    const allowed = ['/api/auth/me', '/api/auth/password', '/api/auth/logout', '/api/referentiels'];
    if (user.must_change_password && !allowed.includes(req.originalUrl.split('?')[0])) {
      return next(new HttpError(403, 'Vous devez changer votre mot de passe'));
    }
    next();
  };
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return next(new HttpError(403, 'Accès refusé'));
    next();
  };
}

// Limitation simple des tentatives de connexion (mémoire) : 10 échecs / 15 min par IP+identifiant.
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function loginThrottle(key) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (entry && now - entry.first < WINDOW_MS && entry.count >= MAX_ATTEMPTS) {
    throw new HttpError(429, 'Trop de tentatives. Réessayez dans quelques minutes.');
  }
  return {
    fail() {
      const e = attempts.get(key);
      if (!e || now - e.first >= WINDOW_MS) attempts.set(key, { first: now, count: 1 });
      else e.count++;
      if (attempts.size > 10000) attempts.clear();
    },
    success() { attempts.delete(key); },
  };
}
