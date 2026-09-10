import { cpus, totalmem } from 'node:os';
import autocannon from 'autocannon';
import { SCENARIOS, SIMULTANEITE, SIMULTANEITE_RUPTURE, type Scenario } from './scenarios.js';

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
const ECHAUFFEMENT = Number(process.env['CHARGE_ECHAUFFEMENT'] ?? '5');

/** Au-dela, on cesse d'attendre le retour au calme et on le dit. */
const ATTENTE_MAXIMALE = 180_000;

/**
 * La latence au-dela de laquelle on cesse de monter les paliers.
 *
 * Un scenario qui repond en cinq secondes a deja plie : les paliers suivants
 * n'apprennent plus rien, ils ne font qu'empiler une file que le serveur mettra
 * des minutes a vider — et qui faussera le scenario d'apres. Le point de rupture
 * est deja lu, on s'arrete dessus.
 */
const PLAFOND_LATENCE = 5000;
/**
 * Une lecture d'un ticket sous ce seuil signe une file vide. Elle coute 15 ms au repos.
 *
 * La sonde de sante ne convient pas : elle touche a peine la base et repondait
 * en quelques millisecondes pendant que PostgreSQL avalait encore cinq cents
 * balayages de table. Il faut une sonde qui **passe par le pool de connexions**,
 * puisque c'est la que la file s'accumule.
 */
const CALME = 150;

interface Mesure {
  readonly scenario: string;
  readonly simultaneite: number;
  /** Un palier de rupture n'est pas juge sur ses seuils. Voir `scenarios.ts`. */
  readonly rupture: boolean;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly parSeconde: number;
  readonly erreurs: number;
  readonly nonDeuxCent: number;
  readonly expirations: number;
  /**
   * Le nombre de requetes **abouties**.
   *
   * Zero ici ne veut pas dire « zero erreur » : si chaque requete est plus
   * lente que le palier lui-meme, aucune ne revient et aucune n'expire — la
   * fenetre se ferme avant. autocannon rend alors des zeros partout, que la
   * premiere version de cet outil affichait comme un resultat. Un palier sans
   * la moindre reponse est le pire des echecs, pas le meilleur des chiffres.
   */
  readonly total: number;
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

async function jouer(
  scenario: Scenario,
  simultaneite: number,
  cookie: string,
  rupture: boolean,
): Promise<Mesure> {
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
    rupture,
    p50: resultat.latency.p50,
    p95: resultat.latency.p97_5,
    p99: resultat.latency.p99,
    parSeconde: Math.round(resultat.requests.average),
    erreurs: resultat.errors,
    nonDeuxCent: resultat.non2xx,
    expirations: resultat.timeouts,
    total: resultat.requests.total,
  };
}

/**
 * Chauffe le cache avant de mesurer, et jette le resultat.
 *
 * Sans cela, le premier palier de chaque scenario mesure le disque et non
 * l'application. Ce n'est pas une hypothese : a cinq cent mille tickets, le
 * premier appel a la liste a pris **82 secondes**, le deuxieme 117, et le
 * troisieme deux — puis vingt millisecondes une fois la table en memoire. Le
 * premier jet de cet outil n'echauffait pas, et la campagne entiere mesurait
 * la lecture d'un fichier de 584 Mio.
 *
 * On mesure a chaud parce que c'est l'etat d'un serveur en service. Un demarrage
 * a froid se mesure une fois, il ne se compare pas entre deux versions.
 */
async function echauffer(scenario: Scenario, cookie: string): Promise<void> {
  if (ECHAUFFEMENT <= 0) return;

  await autocannon({
    url: `${BASE}${scenario.chemin}`,
    method: scenario.methode,
    connections: 4,
    duration: ECHAUFFEMENT,
    headers: { cookie, 'content-type': 'application/json' },
    ...(scenario.corps ? { body: JSON.stringify(scenario.corps) } : {}),
  });
}

/**
 * Attend que la file du serveur se vide, et rend le temps qu'il y a fallu.
 *
 * **Sans cela, un palier mesure la traine du precedent.** Ce n'est pas une
 * precaution theorique : apres un palier a cinq cents connexions, la sonde de
 * sante a mis **cent vingt secondes** a repondre, puis cent douze, puis une
 * seule. Les trois scenarios suivants n'ont alors rendu aucune reponse — non
 * qu'ils soient lents, mais parce qu'ils attendaient derriere le palier d'avant.
 * Le premier jet de cet outil enchainait les paliers sans respirer, et
 * concluait a l'effondrement de routes qui repondent en une seconde.
 *
 * Trois reponses rapides d'affilee, et non une : sous une file qui se vide, une
 * reponse isolee peut passer vite par chance.
 *
 * Le temps de retour au calme est lui-meme une mesure — c'est la reponse a
 * « combien de temps ce service met-il a se remettre d'une rafale », et c'est
 * ce que la colonne ↻ imprime.
 */
async function retourAuCalme(cookie: string): Promise<number> {
  const debut = Date.now();
  let daffilee = 0;

  while (Date.now() - debut < ATTENTE_MAXIMALE) {
    const depart = Date.now();

    try {
      await fetch(`${BASE}/api/tickets?limit=1`, { headers: { cookie } });
      daffilee = Date.now() - depart < CALME ? daffilee + 1 : 0;
    } catch {
      daffilee = 0;
    }

    if (daffilee >= 3) break;

    await new Promise((suite) => setTimeout(suite, 200));
  }

  return Date.now() - debut;
}

function machine(): string {
  const processeur = cpus()[0]?.model.trim().replace(/\s+/g, ' ') ?? 'inconnu';
  const memoire = Math.round(totalmem() / 1024 / 1024 / 1024);

  return `${processeur} · ${String(cpus().length)} fils · ${String(memoire)} Gio · ${process.platform}`;
}

/**
 * Le genou de la courbe : le dernier palier avant que le debit cesse de monter.
 *
 * C'est la seule lecture qui vaille pour dimensionner. Un debit qui plafonne
 * dit qu'une ressource unique est saturee ; ajouter des connexions au-dela
 * n'ajoute que de l'attente, jamais du travail utile.
 */
function genou(mesures: readonly Mesure[]): Mesure | undefined {
  let meilleur: Mesure | undefined;

  for (const mesure of mesures) {
    if (mesure.total === 0) continue;

    // 5 % de marge : deux mesures a un pour cent l'une de l'autre sont le meme
    // plateau, pas une progression.
    if (!meilleur || mesure.parSeconde > meilleur.parSeconde * 1.05) meilleur = mesure;
  }

  return meilleur;
}

/**
 * Le temps qu'il a fallu au serveur pour revenir au calme apres le palier.
 *
 * Sous une seconde, c'est le bruit de la sonde et cela n'apprend rien. Au-dela,
 * c'est la duree pendant laquelle un utilisateur arrive apres la rafale attend
 * encore : elle merite d'etre lue.
 */
function repli(millisecondes: number): string {
  if (millisecondes < 1000) return '';

  return `  ↻ ${(millisecondes / 1000).toFixed(1)} s pour revenir au calme`;
}

function ligne(mesure: Mesure, scenario: Scenario): string {
  const prefixe = `   ${String(mesure.simultaneite).padStart(3)} simultanes`;

  // Aucune reponse : n'imprimer ni percentiles ni debit. Des zeros a cet
  // endroit se lisent comme « instantane » alors qu'ils disent l'inverse.
  if (mesure.total === 0) {
    return `${prefixe}  ✗ aucune reponse en ${String(DUREE)} s — plus lent que le palier lui-meme`;
  }

  const alerte =
    mesure.nonDeuxCent + mesure.erreurs + mesure.expirations > 0
      ? `  ⚠ ${String(mesure.nonDeuxCent)} hors 2xx, ${String(mesure.erreurs)} erreurs,` +
        ` ${String(mesure.expirations)} expirations`
      : !mesure.rupture && mesure.p95 > scenario.seuilP95
        ? `  ⚠ p95 au-dela du seuil (${String(scenario.seuilP95)} ms)`
        : '';

  return (
    prefixe +
    `  p50 ${String(mesure.p50).padStart(5)} ms` +
    `  p95 ${String(mesure.p95).padStart(5)} ms` +
    `  p99 ${String(mesure.p99).padStart(5)} ms` +
    `  ${String(mesure.parSeconde).padStart(6)} req/s` +
    alerte
  );
}

async function main(): Promise<void> {
  const cookie = await ouvrirSession();
  const paliers = [
    ...SIMULTANEITE.map((n) => ({ n, rupture: false })),
    ...SIMULTANEITE_RUPTURE.map((n) => ({ n, rupture: true })),
  ];

  console.log('');
  console.log('Banc d essai Tick&');
  console.log('  machine   : ' + machine());
  console.log('  cible     : ' + BASE);
  console.log('  duree     : ' + String(DUREE) + ' s par palier');
  console.log('  echauffe  : ' + String(ECHAUFFEMENT) + ' s par scenario, non comptes');
  console.log(
    '  paliers   : ' +
      SIMULTANEITE.join(', ') +
      ' (service, seuils appliques) puis ' +
      SIMULTANEITE_RUPTURE.join(', ') +
      ' (rupture, sans seuil)',
  );
  console.log('');
  console.log('  Ces chiffres ne valent que pour cette machine, ce volume et ces scenarios.');
  console.log('  Les publier sans les trois serait malhonnete.');
  console.log('');
  console.log('  Une connexion saturee n est pas un utilisateur : elle en represente une');
  console.log('  vingtaine en activite reelle. Voir scenarios.ts avant de citer un palier.');
  console.log('');

  const mesures: Mesure[] = [];

  for (const scenario of SCENARIOS) {
    console.log(`— ${scenario.nom} : ${scenario.intention}`);

    const siennes: Mesure[] = [];

    await echauffer(scenario, cookie);
    await retourAuCalme(cookie);

    for (const palier of paliers) {
      const mesure = await jouer(scenario, palier.n, cookie, palier.rupture);
      mesures.push(mesure);
      siennes.push(mesure);

      const calme = await retourAuCalme(cookie);

      console.log(ligne(mesure, scenario) + repli(calme));

      if (mesure.total === 0 || mesure.p95 > PLAFOND_LATENCE) {
        console.log(
          `     rupture atteinte a ${String(palier.n)} connexions :` +
            ' les paliers suivants sont abandonnes.',
        );
        break;
      }
    }

    const sommet = genou(siennes);

    if (sommet) {
      console.log(
        `     plafond a ${String(sommet.parSeconde)} req/s` +
          ` des ${String(sommet.simultaneite)} connexions` +
          ` — au-dela, seule l attente augmente`,
      );
    } else {
      console.log('     aucun palier n a rendu de reponse : rien a lire ici.');
    }

    console.log('');
  }

  // Le verdict ne porte que sur les paliers de service, et sur le plus charge
  // d entre eux : un seuil tenu a une connexion ne prouve rien.
  const pire = Math.max(...SIMULTANEITE);
  const service = mesures.filter((m) => !m.rupture);

  const depassements = service.filter((m) => {
    const scenario = SCENARIOS.find((s) => s.nom === m.scenario);

    return m.simultaneite === pire && scenario && m.p95 > scenario.seuilP95;
  });

  // Le silence d'un palier de rupture est le resultat cherche, pas un defaut :
  // il dit ou ca casse. Celui d'un palier de service est une panne.
  const muets = service.filter((m) => m.total === 0);
  const casses = service.filter((m) => m.nonDeuxCent > 0 || m.erreurs > 0 || m.expirations > 0);
  const cassesEnRupture = mesures.filter(
    (m) => m.rupture && m.total > 0 && (m.nonDeuxCent > 0 || m.erreurs > 0),
  );

  if (cassesEnRupture.length > 0) {
    console.log('Des requetes ont echoue aux paliers de rupture. A ces niveaux, le poste de');
    console.log('mesure epuise souvent ses propres ports avant l application — a verifier avant');
    console.log('d en conclure quoi que ce soit sur Tick& :');
    for (const m of cassesEnRupture) {
      console.log(
        `  ${m.scenario} a ${String(m.simultaneite)} simultanes : ` +
          `${String(m.nonDeuxCent)} hors 2xx, ${String(m.erreurs)} erreurs`,
      );
    }
    console.log('');
  }

  if (muets.length > 0) {
    console.error(
      `Des paliers n ont rendu aucune reponse en ${String(DUREE)} s. Ce n est pas un zero,`,
    );
    console.error('c est une requete plus lente que la fenetre de mesure :');
    for (const m of muets) {
      console.error(`  ${m.scenario} a ${String(m.simultaneite)} simultanes`);
    }
    process.exitCode = 1;

    return;
  }

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
