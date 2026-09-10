/**
 * Les cinq comptes du jeu de demonstration, et ce que chacun demontre.
 *
 * Leurs portees sont volontairement differentes : c'est ce qui permet de
 * verifier le cloisonnement pour de vrai, plutot que de tester cinq fois le
 * meme administrateur. Ils sont crees par `pnpm db:reset`, tous avec le meme
 * mot de passe.
 */
export const MOT_DE_PASSE = 'tick';

export interface Compte {
  /** Identifiant de connexion, et nom du fichier de session. */
  readonly nom: string;
  /** Ce que ce compte sert a demontrer, pour que l'echec d'un test se lise. */
  readonly role: string;
}

export const ADMIN: Compte = {
  nom: 'admin',
  role: 'Administrateur sur toute l arborescence',
};

export const SUPERVISEUR: Compte = {
  nom: 'sophie',
  role: 'Superviseur sur la Filiale Nord et sa descendance',
};

export const TECHNICIEN: Compte = {
  nom: 'thomas',
  role: 'Technicien sur Site A seulement, sans descendance',
};

/**
 * Le cas qui justifie le quadruplet objet x action x portee : Lea est
 * technicienne sur Site B **et** simple demandeuse au Siege. Ses droits
 * suivent le profil actif, jamais l'union des deux.
 */
export const DEUX_PROFILS: Compte = {
  nom: 'lea',
  role: 'Technicienne sur Site B et Self-service au Siege',
};

export const DEMANDEUR: Compte = {
  nom: 'demandeur',
  role: 'Self-service sur la DSI, interface simplifiee',
};

export const COMPTES = [ADMIN, SUPERVISEUR, TECHNICIEN, DEUX_PROFILS, DEMANDEUR] as const;

/** Ou la session ouverte d'un compte est deposee entre les scenarios. */
export function sessionDe(compte: Compte): string {
  return `.sessions/${compte.nom}.json`;
}
