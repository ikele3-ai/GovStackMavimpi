// Crée (ou réinitialise) un compte administrateur.
// Usage : npm run create-admin -- <identifiant>
import { generateTempPassword, hashPassword } from '../src/auth.js';
import { config } from '../src/config.js';
import { insert, openDatabase } from '../src/db.js';

const username = process.argv[2] || 'admin';
if (!/^[A-Za-z0-9._-]{3,50}$/.test(username)) {
  console.error('Identifiant invalide (3 à 50 caractères : lettres, chiffres, . _ -)');
  process.exit(1);
}
const db = openDatabase(config.databasePath);
const password = generateTempPassword();
const hash = await hashPassword(password);
const existing = db.prepare('SELECT id, role FROM users WHERE username = ?').get(username);
if (existing && existing.role !== 'admin') {
  console.error(`L'identifiant « ${username} » appartient déjà à un compte ${existing.role}.`);
  process.exit(1);
}
if (existing) {
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, actif = 1 WHERE id = ?').run(hash, existing.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
  console.log(`Mot de passe de l'administrateur « ${username} » réinitialisé.`);
} else {
  insert(db, 'users', { username, password_hash: hash, role: 'admin', nom: 'Administrateur', must_change_password: 1 });
  console.log(`Administrateur « ${username} » créé.`);
}
console.log(`Mot de passe temporaire : ${password}`);
db.close();
