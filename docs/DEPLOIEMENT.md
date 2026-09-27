# Déploiement sur un VPS

Ce guide installe la solution sur un VPS Linux (Ubuntu 22.04/24.04 ou Debian 12) avec Docker et
HTTPS automatique.

## 1. Dimensionnement conseillé

| Usage | vCPU | RAM | Disque |
|---|---|---|---|
| 1 hôpital (≤ 50 médecins, ≤ 100 000 patients) | 2 | 2 Go | 40 Go SSD |
| Plusieurs établissements d'une province | 4 | 4–8 Go | 80 Go SSD |

Privilégiez un hébergement situé en RDC ou dans la région, conformément aux exigences nationales
de souveraineté des données de santé.

## 2. Préparer le serveur

```bash
# Mises à jour et pare-feu : seuls SSH, HTTP et HTTPS sont ouverts
sudo apt update && sudo apt -y upgrade
sudo apt -y install ufw git
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw enable

# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # puis se reconnecter
```

Recommandations : connexion SSH par clé uniquement (`PasswordAuthentication no`), `fail2ban`,
mises à jour de sécurité automatiques (`unattended-upgrades`).

## 3. Nom de domaine

Créez un enregistrement DNS **A** (ex. `dossier.hopital.cd`) pointant vers l'adresse IP du VPS.
Caddy obtiendra et renouvellera automatiquement le certificat HTTPS.

## 4. Installation

```bash
sudo git clone <URL du dépôt> /opt/govstack-sante
sudo chown -R $USER /opt/govstack-sante && cd /opt/govstack-sante
cp .env.example .env
nano .env            # DOMAIN=dossier.hopital.cd, ACME_EMAIL=…
docker compose up -d --build
docker compose ps
docker compose logs app | grep -A3 "administrateur"
```

Ouvrez `https://<votre domaine>`, connectez‑vous avec `admin` et le mot de passe temporaire
affiché, puis choisissez un mot de passe fort.

Mot de passe administrateur perdu :

```bash
docker compose exec app node --disable-warning=ExperimentalWarning scripts/create-admin.js admin
```

## 5. Sauvegardes (indispensable)

```bash
# Sauvegarde manuelle
docker compose exec app node --disable-warning=ExperimentalWarning scripts/backup.js
# Sauvegarde quotidienne à 2h30
sudo crontab -e
30 2 * * * /opt/govstack-sante/deploy/backup-cron.sh >> /var/log/govstack-backup.log 2>&1
```

Les sauvegardes (`/data/backups` dans le volume `sante-data`, 30 conservées par défaut) sont des
copies cohérentes de la base prises à chaud. **Copiez‑les chaque jour hors du VPS**, chiffrées
(ex. `restic`, `rclone` vers un stockage objet), et testez régulièrement la restauration :

```bash
docker compose stop app
docker run --rm -v govstack-sante_sante-data:/data alpine \
  sh -c "cp /data/backups/sante-AAAA-MM-JJTHH-MM-SS.db /data/sante.db && rm -f /data/sante.db-wal /data/sante.db-shm"
docker compose start app
```

## 6. Mise à jour

```bash
cd /opt/govstack-sante
docker compose exec app node --disable-warning=ExperimentalWarning scripts/backup.js
git pull
docker compose up -d --build
```

Les migrations de base de données s'appliquent automatiquement au démarrage.

## 7. Supervision

- État : `https://<domaine>/health` (à brancher sur un outil de surveillance, ex. Uptime Kuma).
- Journaux : `docker compose logs -f app caddy`.
- Journal d'audit fonctionnel : menu **Journal d'audit** du compte administrateur.

## 8. Variante sans Docker (systemd + Caddy natif)

```bash
# Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt -y install nodejs
sudo useradd --system --home /opt/govstack-sante sante
sudo mkdir -p /var/lib/govstack-sante && sudo chown sante /var/lib/govstack-sante
cd /opt/govstack-sante && sudo -u sante npm ci --omit=dev
sudo cp deploy/govstack-sante.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now govstack-sante
# Caddy : reverse_proxy 127.0.0.1:3000 dans /etc/caddy/Caddyfile
```

Ajoutez `COOKIE_SECURE=true` dans `.env` dès que le site est servi en HTTPS.

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Écoute HTTP |
| `DATABASE_PATH` | `./data/sante.db` | Fichier SQLite |
| `BACKUP_DIR` / `BACKUP_KEEP` | `./backups` / `30` | Sauvegardes |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / (généré) | Compte initial |
| `SESSION_TTL_HOURS` | `12` | Durée de session |
| `COOKIE_SECURE` | `true` en production | Cookie HTTPS uniquement |
| `TRUST_PROXY` | `0` | Nombre de proxies devant l'application (`1` avec Caddy) |
| `NUP_PREFIX` | `CD` | Préfixe du Numéro Unique Patient |
