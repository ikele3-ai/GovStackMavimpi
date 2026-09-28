// Sauvegarde à chaud et cohérente de la base (VACUUM INTO), avec rotation.
// Usage : npm run backup      (variables : BACKUP_DIR, BACKUP_KEEP=30)
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../src/config.js';

const keep = Number(process.env.BACKUP_KEEP || 30);
fs.mkdirSync(config.backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const target = path.join(config.backupDir, `sante-${stamp}.db`);

const db = new DatabaseSync(config.databasePath, { readOnly: true });
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();
console.log(`Sauvegarde créée : ${target} (${(fs.statSync(target).size / 1024).toFixed(0)} Ko)`);

const files = fs.readdirSync(config.backupDir).filter((f) => /^sante-.*\.db$/.test(f)).sort();
for (const f of files.slice(0, Math.max(0, files.length - keep))) {
  fs.unlinkSync(path.join(config.backupDir, f));
  console.log(`Ancienne sauvegarde supprimée : ${f}`);
}
