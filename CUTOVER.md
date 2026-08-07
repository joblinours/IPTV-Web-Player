# Bascule vers la stack complète (MySQL + Redis + Jellyfin + Radarr/Sonarr + Prowlarr/qBittorrent)

Ce document est le guide de bascule pour passer de la version actuelle (SQLite, 2 conteneurs) à la nouvelle stack (MySQL, Redis, Jellyfin, Radarr, Sonarr, Prowlarr, qBittorrent). **À suivre dans l'ordre.** Ne pas pousser la branche tant que la checklist "Avant de commencer" n'est pas cochée — Watchtower tire les images `:dev` automatiquement sur ce serveur, donc un push déclenche un déploiement quasi immédiat.

## Avant de commencer (checklist)

- [ ] **Watchtower mis en pause** pour `iptv-backend`/`iptv-frontend` (ou globalement) le temps de la bascule — sinon le nouveau backend peut être tiré avant que MySQL/Redis existent et boucler en crash.
- [ ] Mot de passe MySQL choisi (`MYSQL_PASSWORD`) et mot de passe root (`MYSQL_ROOT_PASSWORD`) — deux valeurs différentes, longues, prêtes à être **exportées** (pas de fichier `.env`, voir étape 2).
- [ ] `backend/.env` **actuellement présent sur le serveur** (déploiement en cours) sous la main, pour en récupérer **verbatim** `JWT_SECRET` et `APP_ENCRYPTION_SECRET` avant de l'abandonner (ne jamais régénérer ces valeurs — voir "Le piège n°1" plus bas). C'est la dernière fois que ce fichier sert à quelque chose : la nouvelle stack ne lit plus de `.env` du tout.
- [ ] Espace disque confirmé pour `/media` (déjà fait : 500 Go+, largement suffisant).
- [ ] Stockage média sur le mirror ZFS, pas un volume Docker — voir "Étape 0" ci-dessous.
- [ ] Compte Usenet : **abandonné**, remplacé par Prowlarr + qBittorrent (100% gratuit, pas d'abonnement).
- [ ] Accès au compte C411 (tracker privé) prêt — URL + clé API/passkey, à ajouter dans Prowlarr après le déploiement.

## Le piège n°1 (à lire avant tout le reste)

`APP_ENCRYPTION_SECRET` chiffre les mots de passe IPTV stockés en base. S'il diffère ne serait-ce que d'un caractère entre l'ancien déploiement et le nouveau, la migration **réussira en apparence à 100%** et tous les comptes IPTV deviendront **définitivement illisibles** — l'erreur n'apparaît que plus tard, en essayant de lire un flux. Le script de migration vérifie ça (`--verify-secrets`) et refuse de committer si un seul secret ne se déchiffre pas, mais seulement si vous lui donnez le bon secret pour commencer. **Copiez `APP_ENCRYPTION_SECRET` tel quel depuis le `backend/.env` actuellement en prod, puis exportez-le** (voir étape 2) — ne le mettez pas dans un nouveau fichier.

## Étape 0 — Préparer le stockage média sur le mirror ZFS

Le volume `media` n'est plus un volume Docker : c'est un bind mount vers `/mnt/zfs-data-mirror/media` (host) — surchargeable via `MEDIA_ROOT` si ce chemin change un jour. `movies/` et `series/` existent déjà ; il manque juste `downloads/` :

```bash
mkdir -p /mnt/zfs-data-mirror/media/downloads/{incomplete,complete}
chown -R 1000:1000 /mnt/zfs-data-mirror/media   # aligné sur PUID/PGID=1000 des conteneurs
```

Résultat attendu :
```
/mnt/zfs-data-mirror/media/
├── movies/              ← déjà présent, root folder Radarr + bibliothèque Jellyfin "Films"
├── series/               ← déjà présent, root folder Sonarr + bibliothèque Jellyfin "Séries"
└── downloads/
    ├── incomplete/
    └── complete/
```

**Note de nommage** : tout `/mnt/zfs-data-mirror/media` est monté en bloc sur `/media` dans chaque conteneur (Jellyfin, Radarr, Sonarr, qBittorrent) — la structure du host se reflète telle quelle à l'intérieur. Le dossier existant s'appelant `series` (pas `tv`), c'est **`/media/series`** qu'il faut utiliser comme root folder Sonarr et comme chemin de bibliothèque Jellyfin "Séries" (déjà pris en compte dans `SONARR_ROOT_FOLDER` du `docker-compose.yml` et dans les étapes 5.3/5.5 ci-dessous).

Comme `downloads/complete` et `movies`/`series` sont sur ce même point de montage, les imports Radarr/Sonarr sont des hardlinks instantanés, pas des copies.

## Étape 1 — Sauvegarde (obligatoire, avant tout)

```bash
cd /chemin/vers/IPTV-Web-Player   # sur le serveur

docker compose stop backend

mkdir -p backups
docker run --rm -v backend_data:/data -v "$PWD/backups:/backup" alpine \
  sh -c 'cp -a /data/. /backup/app-db-'"$(date +%F-%H%M%S)"'/'

# Vérifier que la sauvegarde est saine et noter les compteurs de lignes
sqlite3 backups/app-db-*/app.db "PRAGMA integrity_check;"
sqlite3 backups/app-db-*/app.db \
  "SELECT 'users',COUNT(*) FROM users UNION ALL SELECT 'accounts',COUNT(*) FROM iptv_accounts
   UNION ALL SELECT 'fav',COUNT(*) FROM favorites UNION ALL SELECT 'wp',COUNT(*) FROM watch_progress
   UNION ALL SELECT 'prefs',COUNT(*) FROM user_preferences;" | tee backups/rowcounts.txt

# Noter le digest de l'image actuelle, pour un rollback en une commande si besoin
docker inspect --format '{{index .RepoDigests 0}}' iptv-backend | tee backups/rollback-image.txt
```

## Étape 2 — Préparer les variables d'environnement (aucun fichier `.env`)

`docker-compose.yml` ne lit **aucun fichier `.env`** — chaque variable est déclarée dans les blocs `environment:` du fichier et résolue via `${VAR}`, que Compose va chercher dans l'environnement du shell/service qui lance `docker compose`. Choisissez le mécanisme qui vous convient sur le serveur (unité systemd avec `EnvironmentFile=/etc/streamhub/secrets.env` pointant vers un fichier **hors du repo**, profil shell, secret store de votre gestionnaire de process...) — l'important est que rien de sensible ne finisse jamais dans un fichier suivi par git.

Variables à exporter avant `docker compose up` (reprendre `JWT_SECRET`/`APP_ENCRYPTION_SECRET` **verbatim** depuis le déploiement actuel) :
```bash
export JWT_SECRET='<valeur actuelle, copiée telle quelle>'
export APP_ENCRYPTION_SECRET='<valeur actuelle, copiée telle quelle>'
export MYSQL_ROOT_PASSWORD='<choisir un mot de passe long>'
export MYSQL_PASSWORD='<choisir un autre mot de passe long>'
export REQUESTS_WEBHOOK_SECRET="$(openssl rand -hex 32)"
export PUID=1000 PGID=1000 TZ=Europe/Paris
export CORS_ORIGIN=http://192.168.1.13:8081
export JELLYFIN_PUBLISHED_URL=http://192.168.1.13:8096
```

Le reste (`MYSQL_DATABASE`, `MYSQL_USER`, hôtes internes Redis/MySQL/Jellyfin/Radarr/Sonarr, TTLs...) a déjà des valeurs par défaut sensées directement dans `docker-compose.yml` — rien à exporter pour ceux-là. `JELLYFIN_API_KEY`/`RADARR_API_KEY`/`RADARR_QUALITY_PROFILE_ID`/`SONARR_API_KEY`/`SONARR_QUALITY_PROFILE_ID`/`TMDB_API_KEY` restent vides pour l'instant (défaut `""` ou `0`) — ils s'exportent après la config manuelle (étape 5) puis un `docker compose up -d backend` pour les prendre en compte.

**Si vous utilisez systemd**, la manière la plus propre d'exporter ces valeurs durablement est un `EnvironmentFile=` dans l'unité qui lance `docker compose up`, pointant vers un fichier réservé (ex. `/etc/streamhub/secrets.env`, permissions `600`, **en dehors du répertoire du repo** donc jamais suivi par git) — cela reste conceptuellement un fichier KEY=VALUE, mais il ne vit jamais dans le dépôt ni n'est jamais poussé sur GitHub.

## Étape 3 — Déployer et migrer

```bash
git pull                                    # récupère cette branche une fois poussée
docker compose build backend frontend       # ou `docker compose pull` si vous préférez les images CI
docker compose up -d mysql redis            # attendre qu'ils soient "healthy" (docker compose ps)
docker compose up -d backend                # démarre, crée les tables (001_init) sur une base MySQL vide

docker compose exec backend node dist/scripts/migrate-sqlite-to-mysql.js \
  --sqlite /data-legacy/app.db --verify --verify-secrets
```
- Sortie attendue : compteurs de lignes qui matchent, `verify-secrets: N/N decrypted OK`, `SUCCESS — transaction committed.`
- **Un exit code non nul = rien n'a été écrit** (rollback automatique) → voir "Rollback" ci-dessous, ne pas continuer.

```bash
docker compose up -d frontend
```

**Smoke test** (avant de considérer la bascule réussie) :
1. `curl http://192.168.1.13:8081/api/system/health` → `{"mysql":true,"redis":true}`
2. Se connecter avec `test@test.com` / `testtest`
3. Vérifier que le compte IPTV existant est toujours là et que les catégories/contenus chargent
4. Lancer un VOD déjà commencé avant la bascule → vérifie que la progression a survécu

## Étape 4 — Déployer Jellyfin / Radarr / Sonarr / Prowlarr / qBittorrent

```bash
docker compose up -d jellyfin radarr sonarr prowlarr qbittorrent
```
Le backend reste indifférent à ces conteneurs (`depends_on` volontairement absent pour eux) — l'app IPTV continue de fonctionner même si l'un d'eux n'est pas encore configuré.

## Étape 5 — Configuration manuelle (une fois, dans le navigateur)

Rien ci-dessous n'est scriptable — chaque outil a son propre assistant de première configuration.

**1. qBittorrent — `http://192.168.1.13:8090`**
- Mot de passe temporaire affiché dans les logs au premier démarrage (`docker compose logs qbittorrent | grep -i password`) — à changer immédiatement dans Tools > Options > Web UI.
- Options → Downloads : *Default Save Path* = `/media/downloads/complete`, activer *Keep incomplete torrents in* = `/media/downloads/incomplete`.
- Options → BitTorrent : limiter le nombre de connexions/vitesse si besoin.

**2. Prowlarr — `http://192.168.1.13:9696`**
- Indexers → Add Indexer → **C411** (Newznab/Torznab selon ce que C411 expose — renseigner l'URL + clé API/passkey de votre compte C411). Ajoutez aussi des indexeurs publics gratuits si vous en voulez d'autres.
- Settings → Apps → **Add Radarr** (URL interne `http://radarr:7878`, clé API — récupérée à l'étape 3 ci-dessous) et **Add Sonarr** (`http://sonarr:8989`) → Prowlarr synchronise ensuite automatiquement les indexeurs vers les deux.

**3. Radarr — `http://192.168.1.13:7878`**
- Définir l'authentification admin (obligatoire depuis Radarr v5).
- Settings → Media Management → Root Folders → ajouter `/media/movies`.
- Settings → Profiles → noter l'**id** du profil de qualité voulu (visible dans l'URL en éditant le profil, ex. `/settings/profiles/edit/4` → `4`).
- Settings → Download Clients → **Add qBittorrent** : host `qbittorrent`, port `8090`, identifiants définis à l'étape 1, catégorie `radarr`. Tester.
- Settings → General → copier la **clé API** → `RADARR_API_KEY`.
- Settings → Connect → **Add Webhook** : URL `http://192.168.1.13:8081/api/webhooks/radarr/<REQUESTS_WEBHOOK_SECRET>`, méthode `POST`, déclencheurs : On Grab, On Import, On Movie Added, On Movie Delete, On Movie File Delete. Tester (200 attendu).
- Revenir dans **Prowlarr** et finir la synchro Apps maintenant que la clé API existe.

**4. Sonarr — `http://192.168.1.13:8989`** — identique à Radarr avec :
- Root folder `/media/series`, catégorie qBittorrent `sonarr`.
- Webhook vers `/api/webhooks/sonarr/<secret>`.
- Pas de "language profile" en Sonarr v4 — ne pas chercher, il n'existe plus.

**5. Jellyfin — `http://192.168.1.13:8096`**
- Assistant → compte admin → bibliothèque "Films" (`/media/movies`) + "Séries" (`/media/series`).
- Dashboard → Advanced → API Keys → créer une clé `streamhub` → `JELLYFIN_API_KEY`.

**6. Exporter les clés récupérées** (`JELLYFIN_API_KEY`, `RADARR_API_KEY`, `RADARR_QUALITY_PROFILE_ID`, `SONARR_API_KEY`, `SONARR_QUALITY_PROFILE_ID` — `RADARR_ROOT_FOLDER`/`SONARR_ROOT_FOLDER` ont déjà les bonnes valeurs par défaut dans `docker-compose.yml`) via le même mécanisme qu'à l'étape 2, puis :
```bash
docker compose up -d backend   # relit l'environnement exporté
curl http://192.168.1.13:8081/api/system/integrations
# -> { "tmdb": ..., "jellyfin": true, "radarr": true, "sonarr": true }
```
Si `tmdb` est `false`, la fonctionnalité "Demander un film/série" reste masquée tant que `TMDB_API_KEY` n'est pas ajoutée (pas obligatoire pour le reste de la stack).

## Étape 6 — Réactiver Watchtower

Une fois tout vérifié stable, réactiver Watchtower (ou le laisser en pause si vous préférez continuer à déployer manuellement — c'est plus sûr pour ce genre de changement).

## Rollback (si l'étape 3 échoue ou si un problème apparaît après)

Le volume `backend_data` (SQLite) n'est **jamais touché** par le nouveau code (monté en lecture seule) — le rollback restaure l'état exact d'avant la bascule, sans perte :
```bash
docker compose stop backend frontend
# Revenir à l'image d'avant (digest noté à l'étape 1)
docker compose -f docker-compose.yml -f docker-compose.rollback.yml up -d backend frontend
```
Garder `backend_data` et le digest noté pendant au moins une semaine après une bascule réussie avant de nettoyer quoi que ce soit.
