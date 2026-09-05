import type { Traductions } from './fr.js';

/**
 * English translation.
 *
 * Typed against the French source: any key added there and missing here is a
 * compile error rather than a blank string at runtime.
 */
export const en: Traductions = {
  commun: {
    annuler: 'Cancel',
    chargement: 'Loading…',
    enregistrer: 'Save',
    erreur: 'Error',
    fermer: 'Close',
    rechercher: 'Search',
    reessayer: 'Try again',
  },
  connexion: {
    titre: 'Sign in',
    sousTitre: 'ITSM ticketing tool',
    identifiant: 'Username',
    motDePasse: 'Password',
    valider: 'Sign in',
    enCours: 'Signing in…',
    echec: 'Incorrect username or password.',
    indisponible: 'The service is temporarily unavailable.',
  },
  session: {
    deconnexion: 'Sign out',
    entiteActive: 'Active entity',
    profilActif: 'Active profile',
    sousEntites: 'Include sub-entities',
    badgeSousEntites: '+ sub-entities',
    changerContexte: 'Switch entity or profile',
    aucuneBascule: 'No other authorization',
  },
  entites: {
    titre: 'Entities',
    description: 'Entities visible from your working context.',
    nom: 'Name',
    chemin: 'Path',
    niveau: 'Level',
    aucune: 'No entity visible in this scope.',
    interdit: 'Your active profile does not allow viewing entities.',
  },
  navigation: {
    accueil: 'Home',
    assistance: 'Helpdesk',
    administration: 'Administration',
  },
};
