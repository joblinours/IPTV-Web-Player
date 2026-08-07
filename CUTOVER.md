# Bascule vers la stack complète (MySQL + Redis + Jellyfin + Radarr/Sonarr + Prowlarr/qBittorrent)

Ce document est le guide de bascule pour passer de la version actuelle (SQLite, 2 conteneurs) à la nouvelle stack (MySQL, Redis, Jellyfin, Radarr, Sonarr, Prowlarr, qBittorrent).

**Contrainte de déploiement : Portainer, en une seule salve.** Le déploiement se fait en uploadant `docker-compose.yml` comme stack dans Portainer, qui télécharge les images et démarre tous les conteneurs lui-même — il n'y a pas de séquence manuelle `docker compose up -d <service>` par étapes. Ce guide est écrit pour ce mode de fonctionnement : l'ordre de démarrage (mysql/redis → backend → le reste) est déjà garanti par les `depends_on: condition: service_healthy` du fichier, donc un déploiement en un coup reste sûr — la seule étape qui reste **manuelle après coup** est le script de migration SQLite→MySQL (voir Étape 3), parce qu'une migration de données n'est délibérément pas automatique.

## Avant de commencer (checklist)

- [ ] **Watchtower mis en pause** pour `iptv-backend`/`iptv-frontend` (ou globalement) — sinon Watchtower peut re-tirer une image entre deux de vos actions pendant la bascule.
- [ ] Snapshot machine pris **avant** de mettre à jour la stack dans Portainer (déjà fait — voir "Étape 1" pour ce qu'il couvre et ne couvre pas).
- [ ] Variables d'environnement prêtes à saisir dans le panneau **Environment variables** de Portainer (voir Étape 2) — mot de passe MySQL, mot de passe root MySQL, `JWT_SECRET`/`APP_ENCRYPTION_SECRET` récupérés depuis le déploiement actuel.
- [ ] Stockage média sur le mirror ZFS prêt — voir "Étape 0" ci-dessous.
- [ ] Compte Usenet : **abandonné**, remplacé par Prowlarr + qBittorrent (100% gratuit, pas d'abonnement).
- [ ] Accès au compte C411 (tracker privé) prêt — URL + clé API/passkey, à ajouter dans Prowlarr après le déploiement.

## Le piège n°1 (à lire avant tout le reste)

`APP_ENCRYPTION_SECRET` chiffre les mots de passe IPTV stockés en base. S'il diffère ne serait-ce que d'un caractère entre l'ancien déploiement et le nouveau, la migration **réussira en apparence à 100%** et tous les comptes IPTV deviendront **définitivement illisibles** — l'erreur n'apparaît que plus tard, en essayant de lire un flux. Le script de migration vérifie ça (`--verify-secrets`) et refuse de committer si un seul secret ne se déchiffre pas, mais seulement si vous lui donnez le bon secret pour commencer. **Récupérez `APP_ENCRYPTION_SECRET` tel quel depuis la stack Portainer actuelle (onglet Environment variables du déploiement en cours), et resaisissez-le à l'identique dans la nouvelle stack.**

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

## Étape 1 — Sauvegarde

**Vous avez déjà un snapshot machine** pris avant la bascule — c'est suffisant comme filet de sécurité principal (il couvre le volume `backend_data` avec le SQLite, les images Docker déjà présentes, toute la config). Deux nuances :

- Restaurer un snapshot revient sur **toute la VM** à cet instant, pas juste StreamHub — si vous touchez à autre chose sur cette machine entre le snapshot et la bascule, un rollback snapshot effacerait aussi ces changements.
- Un snapshot n'est **pas une vérification** — il ne dit rien sur l'état du fichier SQLite au moment T. Ces deux commandes sont gratuites et donnent des chiffres indépendants à comparer avec ce que le script de migration annoncera à l'Étape 3 (`--verify`) :

```bash
# Chemin exact du volume : `docker volume inspect <projet>_backend_data` si besoin
sqlite3 /var/lib/docker/volumes/<...>_backend_data/_data/app.db "PRAGMA integrity_check;"
sqlite3 /var/lib/docker/volumes/<...>_backend_data/_data/app.db \
  "SELECT 'users',COUNT(*) FROM users UNION ALL SELECT 'accounts',COUNT(*) FROM iptv_accounts
   UNION ALL SELECT 'fav',COUNT(*) FROM favorites UNION ALL SELECT 'wp',COUNT(*) FROM watch_progress
   UNION ALL SELECT 'prefs',COUNT(*) FROM user_preferences;"
```

Notez ces chiffres quelque part (pas besoin de fichier dans le repo) — vous les comparerez à la sortie du script de migration.

## Étape 2 — Variables d'environnement (dans Portainer, aucun fichier `.env`)

`docker-compose.yml` ne lit **aucun fichier `.env`** — chaque variable est déclarée dans les blocs `environment:` du fichier via `${VAR}`. Dans Portainer, ces valeurs se saisissent dans le panneau **Environment variables** de la stack (Stacks → votre stack → Environment variables), pas dans un fichier du repo — c'est l'équivalent exact d'un export shell, géré par Portainer lui-même.

À saisir (reprendre `JWT_SECRET`/`APP_ENCRYPTION_SECRET` **verbatim** depuis la stack actuelle) :

| Variable | Valeur |
|---|---|
| `JWT_SECRET` | *(copié tel quel depuis la stack actuelle)* |
| `APP_ENCRYPTION_SECRET` | *(copié tel quel depuis la stack actuelle — voir "Le piège n°1")* |
| `MYSQL_ROOT_PASSWORD` | *(nouveau mot de passe long)* |
| `MYSQL_PASSWORD` | *(un autre nouveau mot de passe long)* |
| `REQUESTS_WEBHOOK_SECRET` | sortie de `openssl rand -hex 32` |
| `PUID` / `PGID` | `1000` / `1000` |
| `TZ` | `Europe/Paris` |
| `CORS_ORIGIN` | `http://192.168.1.13:8081` |
| `JELLYFIN_PUBLISHED_URL` | `http://192.168.1.13:8096` |

Le reste (`MYSQL_DATABASE`, `MYSQL_USER`, hôtes internes Redis/MySQL/Jellyfin/Radarr/Sonarr, TTLs...) a déjà des valeurs par défaut sensées directement dans `docker-compose.yml` — inutile de les saisir. Laissez `JELLYFIN_API_KEY`/`RADARR_API_KEY`/`RADARR_QUALITY_PROFILE_ID`/`SONARR_API_KEY`/`SONARR_QUALITY_PROFILE_ID`/`TMDB_API_KEY` vides pour l'instant — ils se remplissent après la config manuelle (Étape 5), puis un redéploiement de la stack (juste le service `backend` si Portainer le permet, sinon toute la stack — sans risque, ce sont des services déjà tous démarrés).

## Étape 3 — Déployer la stack complète et migrer les données

**Tout se déploie en une fois** — Portainer démarre les 9 services ensemble. Grâce à `depends_on: condition: service_healthy` dans `docker-compose.yml`, l'ordre reste garanti : `mysql`/`redis` doivent être `healthy` avant que `backend` démarre réellement (il crée alors automatiquement les tables MySQL vides). `frontend` et tous les services média (Jellyfin/Radarr/Sonarr/Prowlarr/qBittorrent) démarrent en parallèle, sans dépendre de `backend`.

**Point important : il y a une fenêtre entre "la stack est démarrée" et "les données sont migrées"** où le site est joignable sur `http://192.168.1.13:8081/` mais pointe vers une base MySQL **vide** (aucun compte). Ce n'est pas grave en soi, mais :
- **N'ouvrez pas le site et ne vous connectez pas** pendant cette fenêtre — si un compte est créé sur la base vide, le script de migration refusera de continuer (il exige une base cible vide, sauf `--force-truncate`, pour ne jamais écraser silencieusement des données).
- Enchaînez directement sur la migration ci-dessous dès que la stack est up.

1. **Dans Portainer** : Stacks → mettre à jour votre stack avec le nouveau `docker-compose.yml` (+ les variables de l'Étape 2) → déployer. Attendre que `iptv-mysql` et `iptv-redis` passent `healthy` (colonne Status), puis que `iptv-backend` démarre.

2. **Lancer la migration via la console Portainer** (Containers → `iptv-backend` → bouton **Console** → Connect avec `/bin/sh`) :
   ```sh
   node dist/scripts/migrate-sqlite-to-mysql.js --sqlite /data-legacy/app.db --verify --verify-secrets
   ```
   (Si vous préférez le CLI Docker en SSH sur l'hôte : `docker exec -it iptv-backend node dist/scripts/migrate-sqlite-to-mysql.js --sqlite /data-legacy/app.db --verify --verify-secrets`.)

   - Sortie attendue : compteurs de lignes qui matchent ceux notés à l'Étape 1, `verify-secrets: N/N decrypted OK`, `SUCCESS — transaction committed.`
   - **Un exit code non nul = rien n'a été écrit** (rollback automatique côté script) → voir "Rollback" plus bas, ne rien casser en retentant à l'aveugle.

3. **Smoke test** (avant de considérer la bascule réussie) :
   - `curl http://192.168.1.13:8081/api/system/health` → `{"mysql":true,"redis":true}`
   - Se connecter avec `test@test.com` / `testtest`
   - Vérifier que le compte IPTV existant est toujours là et que les catégories/contenus chargent
   - Lancer un VOD déjà commencé avant la bascule → vérifie que la progression a survécu

Les services média (Jellyfin/Radarr/Sonarr/Prowlarr/qBittorrent) sont déjà up à ce stade — `backend` ne dépend d'eux pour rien (`depends_on` volontairement absent), donc rien ci-dessus n'attend leur configuration.

## Étape 4 — Configuration manuelle (une fois, dans le navigateur)

Rien ci-dessous n'est scriptable — chaque outil a son propre assistant de première configuration.

**1. qBittorrent — `http://192.168.1.13:8090`**
- Mot de passe temporaire affiché dans les logs au premier démarrage (Portainer → Containers → `iptv-qbittorrent` → Logs, chercher "password") — à changer immédiatement dans Tools > Options > Web UI.
- Options → Downloads : *Default Save Path* = `/media/downloads/complete`, activer *Keep incomplete torrents in* = `/media/downloads/incomplete`.
- Options → BitTorrent : limiter le nombre de connexions/vitesse si besoin.

**2. Prowlarr — `http://192.168.1.13:9696`**
- Indexers → Add Indexer → **C411** (Newznab/Torznab selon ce que C411 expose — renseigner l'URL + clé API/passkey de votre compte C411). Ajoutez aussi des indexeurs publics gratuits si vous en voulez d'autres.
- Settings → Apps → **Add Radarr** (URL interne `http://radarr:7878`, clé API — récupérée au point 3 ci-dessous) et **Add Sonarr** (`http://sonarr:8989`) → Prowlarr synchronise ensuite automatiquement les indexeurs vers les deux.

**3. Radarr — `http://192.168.1.13:7878`**
- Définir l'authentification admin (obligatoire depuis Radarr v5).
- Settings → Media Management → Root Folders → ajouter `/media/movies`.
- Settings → Profiles → noter l'**id** du profil de qualité voulu (visible dans l'URL en éditant le profil, ex. `/settings/profiles/edit/4` → `4`).
- Settings → Download Clients → **Add qBittorrent** : host `qbittorrent`, port `8090`, identifiants définis au point 1, catégorie `radarr`. Tester.
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

**6. Reporter les clés récupérées dans le panneau Environment variables de Portainer** (`JELLYFIN_API_KEY`, `RADARR_API_KEY`, `RADARR_QUALITY_PROFILE_ID`, `SONARR_API_KEY`, `SONARR_QUALITY_PROFILE_ID` — `RADARR_ROOT_FOLDER`/`SONARR_ROOT_FOLDER` ont déjà les bonnes valeurs par défaut dans `docker-compose.yml`), puis redéployer la stack (Portainer relit l'environnement au redémarrage du conteneur `backend`) :
```bash
curl http://192.168.1.13:8081/api/system/integrations
# -> { "tmdb": ..., "jellyfin": true, "radarr": true, "sonarr": true }
```
Si `tmdb` est `false`, la fonctionnalité "Demander un film/série" reste masquée tant que `TMDB_API_KEY` n'est pas ajoutée (pas obligatoire pour le reste de la stack).

## Étape 5 — Réactiver Watchtower

Une fois tout vérifié stable, réactiver Watchtower (ou le laisser en pause si vous préférez continuer à déployer manuellement via Portainer — c'est plus sûr pour ce genre de changement).

## Rollback

**Option la plus simple : restaurer le snapshot machine** pris avant la bascule (voir Étape 1) — revient sur toute la VM à l'état d'avant, `backend_data` (SQLite) y compris puisqu'il n'a jamais été modifié par le nouveau code.

**Option plus ciblée, si vous préférez ne pas toucher au reste de la VM** : dans Portainer, redéployez la stack avec l'ancienne version de `docker-compose.yml` (celle d'avant cette bascule — Portainer garde généralement un historique des éditions de stack, sinon gardez une copie de l'ancien fichier de côté avant de le remplacer). Le volume `backend_data` n'est jamais touché par le nouveau code (monté en lecture seule), donc revenir à l'ancienne stack retrouve l'état exact d'avant, sans perte.

Garder le snapshot et `backend_data` intacts pendant au moins une semaine après une bascule réussie avant de nettoyer quoi que ce soit.
