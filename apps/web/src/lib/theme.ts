import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';

const CLE = 'tick.theme';

function lire(): Theme {
  const stocke = localStorage.getItem(CLE);

  return stocke === 'light' || stocke === 'dark' ? stocke : 'system';
}

/**
 * Applique le thème au document.
 *
 * « Système » retire l'attribut au lieu d'en poser un troisième : la feuille de
 * style bascule alors sur `prefers-color-scheme`, et l'interface suit le
 * réglage du poste sans qu'on ait à l'observer nous-mêmes.
 */
function appliquer(theme: Theme): void {
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-theme');

    return;
  }

  document.documentElement.setAttribute('data-theme', theme);
}

/**
 * Thème de l'interface, mémorisé sur le poste.
 *
 * Le choix est local et non porté par le compte : c'est une préférence
 * d'affichage liée à l'écran devant lequel on se trouve, et la même personne
 * peut vouloir le mode sombre sur son portable et le mode clair sur le poste
 * fixe de l'atelier.
 */
export function useTheme(): { theme: Theme; setTheme: (valeur: Theme) => void } {
  const [theme, setEtat] = useState<Theme>(() => {
    const initial = lire();

    appliquer(initial);

    return initial;
  });

  const setTheme = useCallback((valeur: Theme) => {
    setEtat(valeur);
    appliquer(valeur);

    if (valeur === 'system') {
      localStorage.removeItem(CLE);

      return;
    }

    localStorage.setItem(CLE, valeur);
  }, []);

  // Un autre onglet a pu changer le réglage : le suivre évite deux fenêtres du
  // même outil qui ne se ressemblent plus.
  useEffect(() => {
    const surStockage = (evenement: StorageEvent): void => {
      if (evenement.key === CLE) setEtat(lire());
    };

    window.addEventListener('storage', surStockage);

    return () => {
      window.removeEventListener('storage', surStockage);
    };
  }, []);

  useEffect(() => {
    appliquer(theme);
  }, [theme]);

  return { theme, setTheme };
}
