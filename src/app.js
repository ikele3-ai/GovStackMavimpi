import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { authenticate, requireRole } from './auth.js';
import { config } from './config.js';
import { REFERENTIELS } from './constants.js';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { fhirRouter } from './routes/fhir.js';
import { patientsRouter, soinsRouter } from './routes/patients.js';
import { rendezVousRouter } from './routes/rendezvous.js';
import { HttpError } from './validation.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  // En-têtes de sécurité
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; " +
        "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    if (config.cookieSecure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  app.use(express.json({ limit: '200kb' }));

  // Protection CSRF : les requêtes qui modifient des données doivent être en JSON
  // (un formulaire d'un site tiers ne peut pas envoyer ce type sans pré-vérification CORS).
  app.use(['/api', '/fhir'], (req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) {
      return next(new HttpError(415, 'Content-Type application/json requis'));
    }
    // Les données médicales ne doivent jamais être mises en cache.
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/health', (req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  const auth = authenticate(db);
  app.use('/api/auth', authRouter(db));
  app.get('/api/referentiels', (req, res) => res.json(REFERENTIELS));
  app.use('/api', auth);
  app.use('/api', adminRouter(db));
  app.use('/api/patients', patientsRouter(db));
  app.use('/api', soinsRouter(db));
  app.use('/api/rendez-vous', rendezVousRouter(db));

  app.get('/api/stats', requireRole('medecin', 'infirmier', 'admin'), (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const count = (sql, ...args) => db.prepare(sql).get(...args).n;
    if (req.user.role === 'admin') {
      return res.json({
        etablissements: count('SELECT COUNT(*) n FROM etablissements'),
        medecins: count("SELECT COUNT(*) n FROM users WHERE role = 'medecin' AND actif = 1"),
        infirmiers: count("SELECT COUNT(*) n FROM users WHERE role = 'infirmier' AND actif = 1"),
        patients: count('SELECT COUNT(*) n FROM patients'),
        comptes_patients: count("SELECT COUNT(*) n FROM users WHERE role = 'patient'"),
        acces_24h: count('SELECT COUNT(*) n FROM audit_log WHERE ts > ?', new Date(Date.now() - 864e5).toISOString()),
      });
    }
    res.json({
      patients: count('SELECT COUNT(*) n FROM patients'),
      consultations_jour: count('SELECT COUNT(*) n FROM consultations WHERE substr(date,1,10) = ?', today),
      mes_soins_jour: count('SELECT COUNT(*) n FROM soins WHERE substr(date,1,10) = ? AND auteur_id = ?', today, req.user.id),
      mes_consultations_jour: count('SELECT COUNT(*) n FROM consultations WHERE substr(date,1,10) = ? AND medecin_id = ?', today, req.user.id),
      hospitalises: count("SELECT COUNT(*) n FROM hospitalisations WHERE statut = 'en_cours' AND etablissement_id IS ?", req.user.etablissement_id ?? null),
      examens_en_attente: count("SELECT COUNT(*) n FROM examens WHERE statut = 'demande' AND etablissement_id IS ?", req.user.etablissement_id ?? null),
      rdv_demandes: req.user.role === 'infirmier'
        ? count("SELECT COUNT(*) n FROM rendez_vous WHERE statut = 'demande' AND etablissement_id IS ?", req.user.etablissement_id ?? null)
        : count("SELECT COUNT(*) n FROM rendez_vous WHERE statut = 'demande' AND (medecin_id = ? OR (medecin_id IS NULL AND etablissement_id IS ?))", req.user.id, req.user.etablissement_id ?? null),
    });
  });

  app.use('/fhir/r4', fhirRouter(db, auth));

  app.use('/api', (req, res, next) => next(new HttpError(404, 'Ressource introuvable')));

  app.use(express.static(publicDir, { index: 'index.html', maxAge: config.env === 'production' ? '1h' : 0 }));
  app.get(/^\/(?!api|fhir).*/, (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

  // Gestion centralisée des erreurs
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = err instanceof HttpError ? err.status : err.status || err.statusCode || 500;
    let message = err instanceof HttpError ? err.message : 'Erreur interne du serveur';
    if (err.type === 'entity.parse.failed') { status = 400; message = 'JSON invalide'; }
    if (err.type === 'entity.too.large') { status = 413; message = 'Requête trop volumineuse'; }
    if (status >= 500) console.error(err);
    if (req.path.startsWith('/fhir')) {
      return res.status(status).type('application/fhir+json').json({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: status === 404 ? 'not-found' : status === 403 || status === 401 ? 'security' : 'processing', diagnostics: message }],
      });
    }
    res.status(status).json({ error: message, details: err.details });
  });

  return app;
}
