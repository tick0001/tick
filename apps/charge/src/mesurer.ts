import { cpus, totalmem } from 'node:os';
import autocannon from 'autocannon';
import { SCENARIOS, SIMULTANEITE, type Scenario } from './scenarios.js';

/**
 * Le banc d'essai : mesurer, dire sur quoi, et refuser de mentir.
 *
 * Un chiffre sans sa machine ne veut rien dire. « Huit cents requetes par
 * seconde » n'est pas une propriete de Tick& : c'est une propriete de Tick& sur
 * ce processeur, avec ce volume de donnees, sur ce scenario. Le rapport imprime
 * donc les trois, et le refus de publier un nombre nu est deliberement inscrit
 * dans l'outil.
 *
 * Ce que la mesure sert a faire, dans l'ordre :
 *
 *   1. **Trouver ou ca plie.** Les seuils sont laches ; ce qui compte est la
 *      forme de la courbe quand la simultaneite monte.
 *   2. **Empecher les regressions.** Une requete qui double de duree entre deux
 *      versions ne se voit dans aucun des 2 347 tests : ils verifient ce que
 *      l'application repond, jamais en combien de temps.
 */

const BASE = process.env['CHARGE_URL'] ?? 'http://localhost:3000';
const COMPTE = process.env['CHARGE_USER'] ?? 'admin';
const MOT_DE_PASSE = process.env['CHARGE_PASSWORD'] ?? 'tick';
const DUREE = Number(process.env['CHARGE_DUREE'] ?? '10');

interface Mesure {
  readonly scenario: string;
  readonly simultaneite: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly parSeconde: number;
  readonly erreurs: number;
  readonly nonDeuxCent: number;
}

/**
 * Ouvre une session, et rend le cookie.
 *
 * Mesurer sans session ne mesurerait que le refus : toutes les routes utiles
 * sont fermees, et l'on obtiendrait des 401 tres rapides — le pire genre de
 * bon chiffre.
 */
async function ouvrirSession(): Promise<string> {
  const reponse = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: COMPTE, password: MOT_DE_PASSE }),
  });

  if (!reponse.ok) {
    throw new Error(
      `Connexion refusee (${String(reponse.status)} pour « ${COMPTE} »).\n` +
        "L'API repond-elle sur " +
        BASE +
        ' ? La base est-elle amorcee ?',
    );
  }

  const cookie = reponse.headers.getSetCookie().find((c) => c.startsWith('tick'));

  if (!cookie) throw new Error("La connexion n'a pose aucun cookie de session.");

  return cookie.split(';')[0] ?? '';
}

async function jouer(scenario: Scenario, simultaneite: number, cookie: string): Promise<Mesure> {
  const resultat = await autocannon({
    url: `${BASE}${scenario.chemin}`,
    method: scenario.methode,
    connections: simultaneite,
    duration: DUREE,
    headers: { cookie, 'content-type': 'application/json' },
    ...(scenario.corps ? { body: JSON.stringify(scenario.corps) } : {}),
  });

  return {
    scenario: scenario.nom,
    simultaneite,
    p50: resultat.latency.p50,
    p95: resultat.latency.p97_5,
    p99: resultat.latency.p99,
    parSeconde: Math.round(resultat.requests.average),
    erreurs: resultat.errors,
    nonDeuxCent: resultat.non2xx,
  };
}

function machine(): string {
  const processeur = cpus()[0]?.model.trim().replace(/\s+/g, ' ') ?? 'inconnu';
  const memoire = Math.round(totalmem() / 1024 / 1024 / 1024);

  return `${processeur} · ${String(cpus().length)} fils · ${String(memoire)} Gio · ${process.platform}`;
}

async function main(): Promise<void> {
  const cookie = await ouvrirSession();

  console.log('');
  console.log('Banc d essai Tick&');
  console.log('  machine   : ' + machine());
  console.log('  cible     : ' + BASE);
  console.log('  duree     : ' + String(DUREE) + ' s par palier');
  console.log('');
  console.log('  Ces chiffres ne valent que pour cette machine, ce volume et ces scenarios.');
  console.log('  Les publier sans les trois serait malhonnete.');
  console.log('');

  const mesures: Mesure[] = [];

  for (const scenario of SCENARIOS) {
    console.log(`— ${scenario.nom} : ${scenario.intention}`);

    for (const simultaneite of SIMULTANEITE) {
      const mesure = await jouer(scenario, simultaneite, cookie);
      mesures.push(mesure);

      const alerte =
        mesure.nonDeuxCent > 0 || mesure.erreurs > 0
          ? `  ⚠ ${String(mesure.nonDeuxCent)} reponses hors 2xx, ${String(mesure.erreurs)} erreurs`
          : mesure.p95 > scenario.seuilP95
            ? `  ⚠ p95 au-dela du seuil (${String(scenario.seuilP95)} ms)`
            : '';

      console.log(
        `   ${String(simultaneite).padStart(3)} simultanes` +
          `  p50 ${String(mesure.p50).padStart(5)} ms` +
          `  p95 ${String(mesure.p95).padStart(5)} ms` +
          `  p99 ${String(mesure.p99).padStart(5)} ms` +
          `  ${String(mesure.parSeconde).padStart(6)} req/s` +
          alerte,
      );
    }

    console.log('');
  }

  // Le verdict porte sur le palier le plus charge : c'est la que la forme de la
  // courbe se lit, et un seuil tenu a une connexion ne prouve rien.
  const pire = Math.max(...SIMULTANEITE);
  const depassements = mesures.filter((m) => {
    const scenario = SCENARIOS.find((s) => s.nom === m.scenario);

    return m.simultaneite === pire && scenario && m.p95 > scenario.seuilP95;
  });

  const casses = mesures.filter((m) => m.nonDeuxCent > 0 || m.erreurs > 0);

  if (casses.length > 0) {
    console.error('Des requetes ont echoue : la mesure ne vaut rien tant que ce n est pas regle.');
    for (const m of casses) {
      console.error(
        `  ${m.scenario} a ${String(m.simultaneite)} simultanes : ` +
          `${String(m.nonDeuxCent)} hors 2xx, ${String(m.erreurs)} erreurs`,
      );
    }
    process.exitCode = 1;

    return;
  }

  if (depassements.length > 0) {
    console.error(`Seuils depasses a ${String(pire)} connexions simultanees :`);
    for (const m of depassements) {
      const seuil = SCENARIOS.find((s) => s.nom === m.scenario)?.seuilP95 ?? 0;
      console.error(`  ${m.scenario} : p95 ${String(m.p95)} ms > ${String(seuil)} ms`);
    }
    process.exitCode = 1;

    return;
  }

  console.log(`Tous les seuils tenus a ${String(pire)} connexions simultanees.`);
}

main().catch((erreur: unknown) => {
  console.error(erreur instanceof Error ? erreur.message : erreur);
  process.exitCode = 1;
});
