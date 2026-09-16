#!/usr/bin/env bash
# Montee de version et restauration, sur une installation qui a des donnees.
#
# Les migrations sont verifiees partout, mais toujours sur une base vide. Rien ne
# verifiait ce qu'un utilisateur reel fait : monter une installation en service,
# avec ses donnees, vers la version suivante. Ni ce qu'il fera le jour ou son
# serveur tombe : restaurer sa sauvegarde.
#
# Trois temps :
#
#   1. La derniere version publiee, amorcee avec le jeu de demonstration. On en
#      releve le contenu table par table, et on la sauvegarde comme le guide
#      d'installation le prescrit.
#   2. Les images a eprouver, sur ces memes volumes. Les migrations en attente
#      jouent sur des donnees reelles ; aucune ligne ne doit avoir disparu.
#   3. Tout est detruit. Une installation neuve, la sauvegarde restauree selon la
#      procedure documentee, puis les images a eprouver. Meme verdict.
#
# Usage :
#   scripts/montee-de-version.sh <version publiee> <etiquette des images locales>
#   scripts/montee-de-version.sh 0.1.9 ci      # tick-api:ci et tick-web:ci

set -Eeuo pipefail

ANCIENNE="${1:?version publiee attendue, par exemple 0.1.9}"
ETIQUETTE="${2:?etiquette des images a eprouver attendue, par exemple ci}"
NOUVELLE="$(node -p "require('./apps/api/package.json').version")"

# Projet et port distincts : le script ne doit rien toucher d'une pile deja en
# route sur la machine, ni de celle du travail « Conteneurs ».
PROJET=tick-montee
PORT="${PORT_MONTEE:-8091}"
URL="http://localhost:${PORT}"

TRAVAIL="$(mktemp -d)"
# Docker lit ce chemin. Sous Git Bash, `/tmp` n'existe que pour le shell : il
# faut la forme Windows du dossier. `cygpath` n'existe pas ailleurs.
if command -v cygpath > /dev/null 2>&1; then
  TRAVAIL="$(cygpath -m "$TRAVAIL")"
fi
ENVIRONNEMENT="${TRAVAIL}/env"

# Sous Git Bash, les arguments qui ressemblent a des chemins sont reecrits avant
# d'atteindre Docker. Sans effet ailleurs.
export MSYS_NO_PATHCONV=1

# `--progress quiet` : la progression de Compose noierait les verdicts.
compose() {
  docker compose --progress quiet -p "$PROJET" -f docker/compose.production.yaml \
    --env-file "$ENVIRONNEMENT" "$@"
}

# Les images passent par l'environnement et non par le fichier : il change d'un
# temps a l'autre, le reste non.
publiee() {
  export TICK_IMAGE_API=ghcr.io/tick0001/tick-api
  export TICK_IMAGE_WEB=ghcr.io/tick0001/tick-web
  export TICK_VERSION="$ANCIENNE"
}

eprouvee() {
  export TICK_IMAGE_API=tick-api
  export TICK_IMAGE_WEB=tick-web
  export TICK_VERSION="$ETIQUETTE"
}

journaux() {
  echo "::group::Journaux de la pile"
  compose logs --no-color --tail 120 || true
  echo "::endgroup::"
}

nettoyer() {
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$TRAVAIL"
}

trap journaux ERR
trap nettoyer EXIT

etape() {
  echo ""
  echo "== $*"
}

# Valeurs jetables : ce sont celles que le fichier compose exige pour demarrer.
cat > "$ENVIRONNEMENT" <<FIN
TICK_PORT=${PORT}
API_URL=${URL}
WEB_URL=${URL}
POSTGRES_USER=tick
POSTGRES_PASSWORD=tick
POSTGRES_DB=tick
DATABASE_URL=postgres://tick:tick@postgres:5432/tick
DATABASE_APP_URL=postgres://tick_app:tick_app@postgres:5432/tick
REDIS_URL=redis://redis:6379
SESSION_SECRET=montee-de-version-jetable
ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_FROM=montee@exemple.invalid
DEFAULT_LOCALE=fr
LOG_LEVEL=warn
FIN

# Attend que l'installation reponde « ok » **dans la version annoncee**. La
# version seule ne prouve pas que l'image a change — juste apres une
# publication, la branche et la version publiee portent le meme numero. D'ou la
# verification de l'image, a part.
attendre() {
  local attendue=$1 reponse
  for _ in $(seq 1 60); do
    if reponse=$(curl -fsS "${URL}/api/health" 2>/dev/null) &&
      node -e 'const r = JSON.parse(process.argv[1]); process.exit(r.status === "ok" && r.version === process.argv[2] ? 0 : 1)' \
        "$reponse" "$attendue"; then
      echo "  sonde : $reponse"
      return 0
    fi
    sleep 5
  done
  echo "::error::L'installation n'a pas repondu « ok » en version ${attendue} dans les cinq minutes."
  return 1
}

image_de_l_api() {
  local attendue="${TICK_IMAGE_API}:${TICK_VERSION}" reelle
  reelle=$(docker inspect --format '{{.Config.Image}}' "$(compose ps -q api)")
  if [ "$reelle" != "$attendue" ]; then
    echo "::error::L'API tourne sur ${reelle}, et non sur ${attendue}."
    return 1
  fi
  echo "  image : ${reelle}"
}

# Le contenu de la base, table par table.
#
# Lu par le proprietaire, superutilisateur du conteneur : il echappe au
# Row-Level Security, et compte donc toutes les lignes et non celles d'une
# entite.
releve() {
  compose exec -T postgres psql -U tick -d tick -At -F ' ' -c "
    SELECT table_name,
           (xpath('/row/n/text()',
                  query_to_xml(format('SELECT count(*) AS n FROM public.%I', table_name),
                               false, true, '')))[1]::text
      FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name" | tr -d '\r'
}

# Chaque table d'avant doit exister apres, avec le meme nombre de lignes. Une
# table nouvelle est permise : c'est ce qu'apporte une migration.
comparer() {
  local avant=$1 apres=$2 ecarts
  ecarts=$(awk '
    NR == FNR { apres[$1] = $2; next }
    !($1 in apres) { print "  " $1 " : disparue, elle avait " $2 " lignes"; next }
    apres[$1] != $2 { print "  " $1 " : " $2 " lignes avant, " apres[$1] " apres" }
  ' "$apres" "$avant")

  if [ -n "$ecarts" ]; then
    echo "::error::Le contenu de la base a change :"
    echo "$ecarts"
    return 1
  fi

  local lignes
  lignes=$(awk '{ s += $2 } END { print s }' "$avant")
  echo "  $(wc -l < "$avant" | tr -d ' ') tables, ${lignes} lignes, contenu identique"
}

# Ce qu'un utilisateur fait en premier : se connecter, puis ouvrir la liste.
usage() {
  local cookies="${TRAVAIL}/cookies" lus
  curl -fsS -c "$cookies" -H 'Content-Type: application/json' \
    -d '{"username":"admin","password":"tick"}' "${URL}/api/auth/login" > /dev/null
  lus=$(curl -fsS -b "$cookies" "${URL}/api/tickets?limit=5" |
    node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => console.log(JSON.parse(s).items.length))')
  if [ "$lus" -lt 1 ]; then
    echo "::error::La connexion reussit, mais la liste des tickets est vide."
    return 1
  fi
  echo "  connexion, puis liste des tickets : ${lus} lus"
}

migrer() {
  compose run --rm --quiet-pull migrate
}

echo "Montee de ${ANCIENNE} (publiee) vers ${TICK_IMAGE_API:-tick-api}:${ETIQUETTE}, version ${NOUVELLE}"

# --- 1. La version publiee, avec des donnees ------------------------------------

etape "1. ${ANCIENNE} publiee, amorcee"
publiee
compose up -d --quiet-pull
attendre "$ANCIENNE"
image_de_l_api
compose exec -T api node dist/cli/seed.js > /dev/null

# L'API est arretee avant le releve. Ses travailleurs de fond — tickets
# recurrents, escalades, enquetes de satisfaction — ecrivent en continu, et le
# releve doit decrire exactement ce que contient la sauvegarde.
compose stop api web > /dev/null
releve > "${TRAVAIL}/avant"

# La commande du guide d'installation, a la lettre.
compose exec -T postgres pg_dump -U tick -Fc tick > "${TRAVAIL}/sauvegarde.dump"
echo "  sauvegarde : $(wc -c < "${TRAVAIL}/sauvegarde.dump" | tr -d ' ') octets"

# --- 2. Montee sur place ---------------------------------------------------------

etape "2. Montee sur place vers ${ETIQUETTE}"
eprouvee

# Le releve se fait entre les migrations et le demarrage de l'API : c'est l'effet
# des migrations qu'on juge ici. L'API, elle, est jugee sur son usage.
migrer
releve > "${TRAVAIL}/apres-montee"
comparer "${TRAVAIL}/avant" "${TRAVAIL}/apres-montee"

compose up -d --quiet-pull
attendre "$NOUVELLE"
image_de_l_api
usage

# --- 3. Restauration sur une installation neuve ----------------------------------

etape "3. Serveur perdu, sauvegarde restauree sur ${ETIQUETTE}"
compose down -v > /dev/null
compose up -d --wait postgres redis

# La procedure documentee, a la lettre. Voir docs/14-installation.md.
compose exec -T postgres psql -U tick -d tick -v ON_ERROR_STOP=1 -q \
  -c "CREATE ROLE tick_app LOGIN PASSWORD 'tick_app'"
compose exec -T postgres pg_restore -U tick -d tick --exit-on-error < "${TRAVAIL}/sauvegarde.dump"

migrer
releve > "${TRAVAIL}/apres-restauration"
comparer "${TRAVAIL}/avant" "${TRAVAIL}/apres-restauration"

compose up -d --quiet-pull
attendre "$NOUVELLE"
image_de_l_api
usage

echo ""
echo "Montee et restauration verifiees."
