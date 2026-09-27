#!/bin/sh
# Sauvegarde quotidienne (à placer dans la crontab root du VPS) :
#   30 2 * * * /opt/govstack-sante/deploy/backup-cron.sh >> /var/log/govstack-backup.log 2>&1
# Les sauvegardes sont conservées dans le volume Docker (/data/backups).
# Copiez-les régulièrement HORS du VPS (autre serveur, stockage objet chiffré…).
set -e
cd "$(dirname "$0")/.."
docker compose exec -T app node --disable-warning=ExperimentalWarning scripts/backup.js
