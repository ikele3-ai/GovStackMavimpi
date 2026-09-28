import { Router } from 'express';
import {
  authenticate, checkPasswordPolicy, clearSessionCookie, createSession, destroySession,
  destroyUserSessions, hashPassword, loginThrottle, setSessionCookie, verifyPassword,
} from '../auth.js';
import { audit } from '../audit.js';
import { HttpError } from '../validation.js';

// Hachage factice pour que la durée de réponse ne révèle pas l'existence d'un compte.
const DUMMY_HASH = 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

export function authRouter(db) {
  const r = Router();
  const auth = authenticate(db);

  r.post('/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
      throw new HttpError(400, 'Identifiant et mot de passe requis');
    }
    const throttle = loginThrottle(`${req.ip}|${username.trim().toLowerCase()}`);
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
    const ok = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok || !user.actif) {
      throttle.fail();
      audit(db, req, 'CONNEXION_ECHEC', { type: 'user', details: { username: username.trim().slice(0, 100) } });
      throw new HttpError(401, 'Identifiant ou mot de passe incorrect');
    }
    throttle.success();
    const { token, expires } = createSession(db, user.id, req);
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), user.id);
    req.user = user;
    audit(db, req, 'CONNEXION', { type: 'user', id: user.id, patientId: user.patient_id });
    setSessionCookie(res, token, expires);
    res.json({
      token,
      expires,
      user: { id: user.id, username: user.username, role: user.role, must_change_password: !!user.must_change_password },
    });
  });

  r.post('/logout', auth, (req, res) => {
    destroySession(db, req.sessionToken);
    audit(db, req, 'DECONNEXION', { type: 'user', id: req.user.id });
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  r.get('/me', auth, (req, res) => {
    const u = req.user;
    res.json({ ...u, actif: !!u.actif, must_change_password: !!u.must_change_password });
  });

  r.post('/password', auth, async (req, res) => {
    const { current_password, new_password } = req.body || {};
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (typeof current_password !== 'string' || !(await verifyPassword(current_password, row.password_hash))) {
      throw new HttpError(400, 'Mot de passe actuel incorrect');
    }
    checkPasswordPolicy(new_password);
    if (new_password === current_password) throw new HttpError(400, 'Le nouveau mot de passe doit être différent');
    const hash = await hashPassword(new_password);
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, req.user.id);
    // Invalide les autres sessions puis en ouvre une nouvelle.
    destroyUserSessions(db, req.user.id);
    const { token, expires } = createSession(db, req.user.id, req);
    setSessionCookie(res, token, expires);
    audit(db, req, 'CHANGEMENT_MOT_DE_PASSE', { type: 'user', id: req.user.id });
    res.json({ ok: true, token, expires });
  });

  return r;
}
