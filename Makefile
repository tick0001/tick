# Raccourcis de deploiement et de developpement.
#
# La raison d'etre de ce fichier tient dans une ligne :
#
#   docker compose -f docker/compose.production.yaml -f docker/compose.traefik.yaml -f docker/compose.demo.yaml up -d
#
# Trois `-f` a taper de memoire, dans le bon ordre, sans en oublier un. Un `-f`
# manquant ne provoque aucune erreur : la pile demarre, simplement sans la
# surcouche — une demonstration sans ses refus d'ecriture, ou une production
# sans son routage. C'est exactement le genre de faute qui ne se voit pas.
#
# `make` n'est pas requis pour travailler sur le projet : les commandes de
# developpement restent disponibles via `pnpm`. Il l'est en revanche sur le
# serveur, ou il evite les fautes de frappe qui coutent cher.

SHELL := /bin/sh

COMPOSE     := docker compose
PROD        := $(COMPOSE) -f docker/compose.production.yaml
PROD_TLS    := $(PROD) -f docker/compose.traefik.yaml
DEMO        := $(PROD_TLS) -f docker/compose.demo.yaml
# Nom de projet distinct, et ce n'est pas cosmetique : `compose.yaml` et
# `compose.production.yaml` declarent tous deux `name: tick` et les memes
# volumes. Sans cette isolation, essayer la demonstration sur une machine de
# developpement ferait tourner la pile de production sur la base de
# developpement — que la remise a zero horaire viderait.
DEMO_LOCAL  := $(COMPOSE) -p tick-demo-locale -f docker/compose.production.yaml -f docker/compose.demo.yaml
DEV         := $(COMPOSE) -f docker/compose.yaml

.DEFAULT_GOAL := aide
.PHONY: aide dev dev-services dev-arret dev-remise-a-zero verifier images \
        prod prod-journal prod-arret prod-migrer prod-admin \
        demo demo-journal demo-arret demo-locale demo-locale-arret \
        version

# --- Aide --------------------------------------------------------------------

aide:
	@echo ''
	@echo 'Developpement'
	@echo '  make dev                  services + API + interface'
	@echo '  make dev-services         PostgreSQL, Redis, Mailpit, OpenLDAP seuls'
	@echo '  make dev-remise-a-zero    base vierge, migree et amorcee'
	@echo '  make verifier             lint, typecheck, format et tests'
	@echo '  make images               construit tick-api:local et tick-web:local'
	@echo ''
	@echo 'Publication'
	@echo '  make version V=0.1.7      coupe release/0.1.7, prete a fusionner dans main'
	@echo ''
	@echo 'Production (derriere un Traefik deja en place)'
	@echo '  make prod                 demarre ou met a jour la pile'
	@echo '  make prod-migrer          applique les migrations, sans redemarrer'
	@echo '  make prod-admin           cree le premier administrateur'
	@echo '  make prod-etat            etat et sante des conteneurs'
	@echo '  make prod-journal         suit les journaux (Ctrl-C pour sortir)'
	@echo '  make prod-arret           arrete, sans toucher aux donnees'
	@echo ''
	@echo 'Demonstration publique'
	@echo '  make demo                 pile + Traefik + surcouche de demonstration'
	@echo '  make demo-locale          la meme sans Traefik, sur TICK_PORT'
	@echo '  make demo-etat            etat et sante des conteneurs'
	@echo '  make demo-journal         suit la remise a zero (Ctrl-C pour sortir)'
	@echo '  make demo-journal-api     suit le journal de l API'
	@echo '  make demo-arret           arrete'
	@echo ''
	@echo 'La configuration se lit dans docker/.env, jamais a la racine :'
	@echo 'Compose la cherche a cote du premier fichier -f.'
	@echo ''

# --- Developpement -----------------------------------------------------------

dev-services:
	$(DEV) up -d

dev: dev-services
	pnpm dev

dev-arret:
	$(DEV) down

# Detruit les donnees de developpement, puis rejoue migrations et amorcage.
dev-remise-a-zero:
	pnpm db:reset

verifier:
	pnpm lint
	pnpm typecheck
	pnpm format:check
	pnpm test

images:
	pnpm images

# --- Production --------------------------------------------------------------
#
# `up -d` sert aussi bien au premier demarrage qu'a la mise a jour : Compose
# recree les conteneurs dont la definition ou l'image a change, et laisse les
# autres en place.

prod:
	$(PROD_TLS) up -d

# Lecture seule : rien n'est demarre, arrete ni recree.
prod-etat:
	$(PROD_TLS) ps

prod-journal:
	$(PROD_TLS) logs -f --tail 100

# `down` sans `-v` : les volumes survivent, donc la base et les pieces jointes
# aussi. Ajouter `-v` a la main est une decision, pas un raccourci.
prod-arret:
	$(PROD_TLS) down

# Rejoue les migrations sans redemarrer l'API. Utile apres une montee de version
# ou le service `migrate` a deja rendu la main.
prod-migrer:
	$(PROD_TLS) run --rm migrate

# Sans lui, une base migree est une base dans laquelle personne ne peut entrer.
# Le mot de passe passe par l'environnement et non par un argument : sur un
# serveur, un argument de ligne de commande se lit dans `ps`.
prod-admin:
	@test -n "$(MOT_DE_PASSE)" || { \
		echo 'Usage : make prod-admin MOT_DE_PASSE=... [COURRIEL=...]'; exit 1; }
	$(PROD_TLS) run --rm \
		-e TICK_ADMIN_PASSWORD='$(MOT_DE_PASSE)' \
		-e TICK_ADMIN_EMAIL='$(COURRIEL)' \
		api node dist/cli/initialiser.js

# --- Demonstration -----------------------------------------------------------
#
# La surcouche recharge le jeu de demonstration a chaque heure ronde : elle
# **vide la base**. Ne jamais la superposer a une installation reelle.
#
# Elle exige une image 0.1.5 ou plus recente : les precedentes n'ont pas le
# point d'extension nginx, et ses refus d'ecriture y seraient ignores en silence.

demo:
	$(DEMO) up -d

demo-etat:
	$(DEMO) ps

demo-journal:
	$(DEMO) logs -f --tail 50 demo-reset

demo-journal-api:
	$(DEMO) logs -f --tail 100 api

demo-arret:
	$(DEMO) down

# Sans Traefik, pour essayer la demonstration sur une machine de developpement.
# Publie l'interface sur TICK_PORT.
demo-locale:
	$(DEMO_LOCAL) up -d

demo-locale-arret:
	$(DEMO_LOCAL) down -v

# --- Publication -------------------------------------------------------------
#
# Le numero de version vit dans le nom de la branche, et la fusion de cette
# branche dans `main` declenche tout le reste : etiquette, images, archives.
# Cette cible ne fait que preparer la branche, correctement.
#
# Elle ne pousse rien et n'ouvre aucune pull request : relire le journal avant
# de publier est le dernier moment ou l'on peut encore corriger ce qu'il annonce.

version:
	@test -n "$(V)" || { echo 'Usage : make version V=0.1.7'; exit 1; }
	@echo "$(V)" | grep -Eq '^[0-9]+[.][0-9]+[.][0-9]+$$' || { echo "'$(V)' n'est pas un numero de version."; exit 1; }
	@git rev-parse --verify --quiet release/$(V) >/dev/null && { echo 'La branche release/$(V) existe deja.'; exit 1; } || true
	git switch -c release/$(V) develop
	node -e "const f='apps/api/package.json',m=require('./'+f);m.version='$(V)';require('fs').writeFileSync(f,JSON.stringify(m,null,2)+String.fromCharCode(10))"
	@echo ''
	@echo 'Branche release/$(V) creee, manifeste monte.'
	@echo 'Datez la section du CHANGELOG, puis :'
	@echo '  git commit -am ":bookmark: version $(V)" && git push -u origin release/$(V)'
