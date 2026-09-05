/**
 * Langue source du projet.
 *
 * Le français fait référence : les autres langues en dérivent, et le type des
 * clés est déduit de ce fichier. Une clé ajoutée ici sans traduction ailleurs
 * devient une erreur de compilation, jamais une chaîne manquante à l'écran.
 */
export const fr = {
  commun: {
    annuler: 'Annuler',
    chargement: 'Chargement…',
    enregistrer: 'Enregistrer',
    erreur: 'Erreur',
    fermer: 'Fermer',
    rechercher: 'Rechercher',
    reessayer: 'Réessayer',
  },
  connexion: {
    titre: 'Connexion',
    sousTitre: 'Outil de ticketing ITSM',
    identifiant: 'Identifiant',
    motDePasse: 'Mot de passe',
    valider: 'Se connecter',
    enCours: 'Connexion…',
    echec: 'Identifiant ou mot de passe incorrect.',
    indisponible: 'Le service est momentanément indisponible.',
  },
  session: {
    deconnexion: 'Se déconnecter',
    entiteActive: 'Entité active',
    profilActif: 'Profil actif',
    sousEntites: 'Inclure les sous-entités',
    badgeSousEntites: '+ sous-entités',
    changerContexte: "Changer d'entité ou de profil",
    aucuneBascule: 'Aucune autre habilitation',
  },
  entites: {
    titre: 'Entités',
    // La visibilité dépend du contexte de travail : le préciser évite de faire
    // croire à une perte de données quand une branche n'apparaît pas.
    description: 'Entités visibles depuis votre contexte de travail.',
    nom: 'Nom',
    chemin: 'Chemin',
    niveau: 'Niveau',
    aucune: 'Aucune entité visible dans ce périmètre.',
    interdit: 'Votre profil actif ne permet pas de consulter les entités.',
  },
  navigation: {
    accueil: 'Accueil',
    assistance: 'Assistance',
    administration: 'Administration',
  },
} as const;

/**
 * Structure des traductions, feuilles elargies a `string`.
 *
 * `as const` fige les valeurs françaises en types litteraux, ce qui est utile
 * pour l'autocompletion des cles mais rendrait toute traduction impossible :
 * l'anglais ne peut pas etre du type « la chaine française exacte ». Ce type
 * conserve donc la forme et libere les valeurs.
 */
type Feuilles<T> = { [K in keyof T]: T[K] extends string ? string : Feuilles<T[K]> };

export type Traductions = Feuilles<typeof fr>;
