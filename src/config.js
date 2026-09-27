import path from 'node:path';

const env = process.env;

export const config = {
  env: env.NODE_ENV || 'development',
  port: Number(env.PORT || 3000),
  host: env.HOST || '0.0.0.0',
  databasePath: env.DATABASE_PATH || path.resolve('data', 'sante.db'),
  backupDir: env.BACKUP_DIR || path.resolve('backups'),
  // Durée de validité d'une session (heures)
  sessionTtlHours: Number(env.SESSION_TTL_HOURS || 12),
  // Cookie "Secure" : obligatoire en production derrière HTTPS
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production',
  // Nombre de proxies de confiance (Caddy/Nginx devant l'application)
  trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) : 0,
  // Compte administrateur créé au premier démarrage si aucun utilisateur n'existe
  adminUsername: env.ADMIN_USERNAME || 'admin',
  adminPassword: env.ADMIN_PASSWORD || '',
  // Préfixe du Numéro Unique Patient (NUP)
  nupPrefix: env.NUP_PREFIX || 'CD',
  appName: env.APP_NAME || 'GovStack Santé RDC',
};
