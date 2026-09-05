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
  tickets: {
    titre: 'Tickets',
    description: 'Tickets visibles selon votre profil actif et votre contexte de travail.',
    aucun: 'Aucun ticket ne correspond.',
    interdit: 'Votre profil actif ne permet pas de consulter les tickets.',
    numero: 'N°',
    sujet: 'Sujet',
    statut: 'Statut',
    priorite: 'Priorité',
    categorie: 'Catégorie',
    demandeurs: 'Demandeur',
    attribue: 'Attribué à',
    ouvertLe: 'Ouvert le',
    echeance: 'Échéance',
    entite: 'Entité',
    suivis: 'suivis',
    taches: 'tâches',
    plus: 'Charger la suite',
    filtres: {
      recherche: 'Rechercher un ticket',
      tous: 'Tous les statuts',
      ouverts: 'Ouverts',
      mesTickets: 'Où je suis acteur',
      corbeille: 'Corbeille',
    },
    statuts: {
      new: 'Nouveau',
      assigned: 'En cours (attribué)',
      planned: 'En cours (planifié)',
      waiting: 'En attente',
      solved: 'Résolu',
      closed: 'Clos',
    },
    priorites: {
      p1: 'Très basse',
      p2: 'Basse',
      p3: 'Moyenne',
      p4: 'Haute',
      p5: 'Très haute',
    },
    types: {
      incident: 'Incident',
      request: 'Demande',
    },
    detail: {
      retour: 'Retour à la liste',
      urgence: 'Urgence',
      impact: 'Impact',
      source: 'Source',
      lieu: 'Lieu',
      tempsInterne: 'Temps interne',
      minutes: 'min',
      priseEnCompte: 'Pris en compte',
      resolu: 'Résolu',
      clos: 'Clos',
      acteurs: 'Acteurs',
      chronologie: 'Chronologie',
      aucuneEntree: 'Rien à afficher pour le moment.',
      ajouterSuivi: 'Ajouter un suivi',
      suiviPlaceholder: 'Décrire ce qui a été fait ou constaté…',
      suiviPrive: 'Privé (invisible du demandeur)',
      envoyer: 'Publier',
      changerStatut: 'Changer le statut',
      prive: 'privé',
    },
    roles: {
      requester: 'Demandeur',
      observer: 'Observateur',
      assigned: 'Attribué à',
    },
    chronologie: {
      followup: 'Suivi',
      task: 'Tâche',
      solution: 'Solution',
      validation: 'Validation',
      log: 'Historique',
    },
  },
  navigation: {
    accueil: 'Accueil',
    assistance: 'Assistance',
    tickets: 'Tickets',
    entites: 'Entités',
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
