import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { BadRequestException } from '@nestjs/common';
import { loadEnv } from '../config/env.js';

/**
 * Refus des connexions sortantes vers les reseaux internes.
 *
 * Deux fonctionnalites laissent un administrateur choisir librement l'hote et
 * le port d'une connexion emise par le serveur : les annuaires LDAP et les
 * collecteurs de courriel. Toutes deux se declenchent a la demande. C'est,
 * telle quelle, une requete sortante arbitraire — de quoi cartographier le
 * reseau de la machine depuis l'exterieur, si celui qui detient le compte
 * d'administration n'est pas de confiance.
 *
 * Dans une installation ordinaire, il l'est, et l'annuaire vise **est**
 * interne : refuser par defaut casserait le cas courant au profit d'une menace
 * qui ne s'y presente pas. Le controle est donc **desactive par defaut** et
 * s'active par `ALLOW_PRIVATE_OUTBOUND=false` — sur une demonstration publique,
 * sur une instance mutualisee, partout ou le compte d'administration est
 * distribue plus largement que la confiance.
 *
 * **Ce que ce controle ne fait pas.** Il resout le nom au moment de la
 * validation et au moment de la connexion, mais rien n'empeche un nom de
 * pointer successivement vers une adresse publique puis vers une adresse
 * privee — le « DNS rebinding ». S'en premunir demanderait d'epingler
 * l'adresse resolue jusqu'a l'ouverture de la connexion, ce que ni `ldapts` ni
 * `imapflow` n'exposent. Le controle eleve le cout de l'attaque ; il ne la rend
 * pas impossible.
 */

/**
 * Plages refusees.
 *
 * `169.254.0.0/16` merite une mention : elle porte l'adresse de metadonnees des
 * hebergeurs, ou se lisent les identifiants d'instance. C'est la cible la plus
 * rentable d'une requete sortante arbitraire.
 */
const INTERNES = new BlockList();
INTERNES.addSubnet('0.0.0.0', 8, 'ipv4');
INTERNES.addSubnet('10.0.0.0', 8, 'ipv4');
INTERNES.addSubnet('100.64.0.0', 10, 'ipv4');
INTERNES.addSubnet('127.0.0.0', 8, 'ipv4');
INTERNES.addSubnet('169.254.0.0', 16, 'ipv4');
INTERNES.addSubnet('172.16.0.0', 12, 'ipv4');
INTERNES.addSubnet('192.0.0.0', 24, 'ipv4');
INTERNES.addSubnet('192.168.0.0', 16, 'ipv4');
INTERNES.addSubnet('198.18.0.0', 15, 'ipv4');
INTERNES.addSubnet('224.0.0.0', 4, 'ipv4');
INTERNES.addSubnet('240.0.0.0', 4, 'ipv4');
INTERNES.addAddress('::', 'ipv6');
INTERNES.addAddress('::1', 'ipv6');
INTERNES.addSubnet('fc00::', 7, 'ipv6');
INTERNES.addSubnet('fe80::', 10, 'ipv6');

/** Vrai si l'adresse appartient a une plage interne. */
export function adresseInterne(adresse: string): boolean {
  const version = isIP(adresse);
  if (version === 0) return false;
  return INTERNES.check(adresse, version === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Refuse un hote qui resout vers une adresse interne.
 *
 * Ne fait rien quand le controle est desactive, ce qui est le reglage par
 * defaut. Le message nomme la variable a changer : un refus dont on ne
 * comprend pas la cause fait perdre plus de temps que la protection n'en fait
 * gagner.
 */
export async function verifierHoteSortant(hote: string): Promise<void> {
  if (loadEnv().ALLOW_PRIVATE_OUTBOUND) return;

  const brut = hote.trim().replace(/^\[|\]$/g, '');

  // Une adresse litterale ne se resout pas : elle se verifie telle quelle.
  if (isIP(brut) !== 0) {
    if (adresseInterne(brut)) {
      throw new BadRequestException(
        `L'adresse ${brut} appartient a un reseau interne, refuse par ALLOW_PRIVATE_OUTBOUND=false.`,
      );
    }
    return;
  }

  let adresses;
  try {
    adresses = await lookup(brut, { all: true });
  } catch {
    // Un nom qui ne resout pas ne peut atteindre aucun reseau interne. On
    // laisse la connexion echouer plus loin, avec son message d'origine, plutot
    // que de la refuser ici pour une raison qui n'est pas la bonne.
    return;
  }

  const interdite = adresses.find((a) => adresseInterne(a.address));
  if (interdite) {
    throw new BadRequestException(
      `L'hote ${brut} resout vers ${interdite.address}, sur un reseau interne, ` +
        `refuse par ALLOW_PRIVATE_OUTBOUND=false.`,
    );
  }
}
