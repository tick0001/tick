#!/bin/sh
# Remise a zero de la demonstration publique.
#
# Monte dans le conteneur `demo-reset` par docker/compose.demo.yaml. Ce script
# vit dans un fichier plutot que dans le YAML : une boucle shell ecrite dans un
# champ `command` demande d'echapper chaque `$`, se relit mal, et Compose la
# decoupe de facon surprenante.
#
# Il n'a rien a faire sur une installation reelle : `seed.js` tronque toutes les
# tables avant d'ecrire.

set -u

STOCKAGE="${STORAGE_PATH:-/app/storage}"

reinitialiser() {
  echo "[demo] remise a zero $(date -u +%FT%TZ)"

  if ! node dist/cli/seed.js; then
    # On ne vide pas le stockage si l'amorcage a echoue : mieux vaut une
    # demonstration figee sur des donnees coherentes qu'une demonstration dont
    # les tickets referencent des pieces jointes disparues.
    echo "[demo] amorcage en echec, stockage conserve" >&2
    return 1
  fi

  # Les visiteurs televersent ce qu'ils veulent. Sans ce nettoyage, le volume
  # grossit sans fin et la demonstration finit par heberger durablement des
  # fichiers que personne n'a relus.
  find "$STOCKAGE" -mindepth 1 -delete 2>/dev/null || true
  echo "[demo] pret"
}

reinitialiser || true

while true; do
  # Vise l'heure ronde plutot qu'un intervalle depuis le demarrage : on peut
  # alors annoncer « remise a zero a chaque heure » sans mentir.
  sleep $((3600 - $(date +%s) % 3600))
  reinitialiser || true
done
