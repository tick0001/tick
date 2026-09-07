import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';

/**
 * Perdre la session ramène à l'accueil.
 *
 * L'adresse survit à la déconnexion. Sans cette remise à zéro, se reconnecter
 * rejoue l'écran qu'on avait sous les yeux — et rien ne dit que le profil
 * retrouvé y a encore droit : on rouvrirait `/settings/users` sur un compte de
 * technicien, qui verrait un refus sans le rapprocher de sa reconnexion.
 *
 * La cible est `/`, et non un écran nommé : la route d'accueil dépend de
 * l'interface du profil, et c'est justement ce qu'il faut laisser décider après
 * la reconnexion plutôt que de figer ici.
 *
 * Le déclencheur est la **transition** vers l'état déconnecté, pas l'état
 * lui-même. La différence n'est pas cosmétique :
 *
 *  - remettre l'adresse à zéro à chaque rendu déconnecté empêcherait toute
 *    navigation pendant que l'écran de connexion est affiché ;
 *  - et surtout, arriver sur `/tickets/12` **sans** session — un lien reçu par
 *    courriel — doit ouvrir ce ticket après la connexion. « Je n'étais pas
 *    connecté » et « j'ai été déconnecté » ne se traitent pas pareil.
 */
export function useRetourAccueilALaDeconnexion(connecte: boolean): void {
  const navigate = useNavigate();
  const etaitConnecte = useRef(connecte);

  useEffect(() => {
    if (etaitConnecte.current && !connecte) {
      void navigate('/', { replace: true });
    }

    etaitConnecte.current = connecte;
  }, [connecte, navigate]);
}
