import { createApp } from './app.js';
import { generateTempPassword, hashPassword } from './auth.js';
import { config } from './config.js';
import { insert, openDatabase } from './db.js';

const db = openDatabase(config.databasePath);

// Premier démarrage : création du compte administrateur.
if (!db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) {
  const password = config.adminPassword || generateTempPassword();
  insert(db, 'users', {
    username: config.adminUsername,
    password_hash: await hashPassword(password),
    role: 'admin',
    nom: 'Administrateur',
    must_change_password: 1,
  });
  console.log('==============================================================');
  console.log(` Compte administrateur créé : ${config.adminUsername}`);
  if (!config.adminPassword) console.log(` Mot de passe temporaire   : ${password}`);
  console.log(' Changez ce mot de passe dès la première connexion.');
  console.log('==============================================================');
}

const app = createApp(db);
const server = app.listen(config.port, config.host, () => {
  console.log(`${config.appName} en écoute sur http://${config.host}:${config.port} (${config.env})`);
});

function shutdown(signal) {
  console.log(`${signal} reçu, arrêt en cours…`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
