import type { SVGProps } from 'react';

/**
 * Jeu d'icônes minimal.
 *
 * Écrit ici plutôt qu'importé : une bibliothèque d'icônes embarque plusieurs
 * milliers de tracés pour la vingtaine dont cette interface a besoin, et impose
 * son propre rythme de mise à jour. Le style est uniforme — trait de 1,5,
 * extrémités arrondies, grille de 24 — parce que c'est ce qui fait qu'un jeu
 * d'icônes tient ensemble, bien plus que le nombre de tracés.
 */
function Trace(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    />
  );
}

export type Icone = (props: SVGProps<SVGSVGElement>) => React.ReactElement;

export const IconTicket: Icone = (props) => (
  <Trace {...props}>
    <path d="M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-6Z" />
    <path d="M13 5v2M13 11v2M13 17v2" strokeDasharray="0.1 3.5" />
  </Trace>
);

export const IconProbleme: Icone = (props) => (
  <Trace {...props}>
    <path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </Trace>
);

export const IconChangement: Icone = (props) => (
  <Trace {...props}>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="6" cy="18" r="2.5" />
    <circle cx="18" cy="12" r="2.5" />
    <path d="M6 8.5v7M8.5 6h4a3 3 0 0 1 3 3v.8M8.5 18h4a3 3 0 0 0 3-3v-.8" />
  </Trace>
);

export const IconPlanning: Icone = (props) => (
  <Trace {...props}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Trace>
);

export const IconCatalogue: Icone = (props) => (
  <Trace {...props}>
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
  </Trace>
);

export const IconConnaissance: Icone = (props) => (
  <Trace {...props}>
    <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19a1 1 0 0 1 1 1v13H5.5A1.5 1.5 0 0 0 4 18.5Z" />
    <path d="M4 18.5A1.5 1.5 0 0 0 5.5 20H20" />
    <path d="M8.5 7.5h7M8.5 11h4" />
  </Trace>
);

export const IconRecherche: Icone = (props) => (
  <Trace {...props}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.4-4.4" />
  </Trace>
);

export const IconStatistiques: Icone = (props) => (
  <Trace {...props}>
    <path d="M3 21h18" />
    <path d="M6 21V11M11 21V4M16 21v-6M21 21v-9" />
  </Trace>
);

export const IconEntites: Icone = (props) => (
  <Trace {...props}>
    <path d="M3 21V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15" />
    <path d="M13 10h6a2 2 0 0 1 2 2v9M2 21h20" />
    <path d="M6.5 8h3M6.5 12h3M6.5 16h3M16.5 14h1.5M16.5 17.5h1.5" />
  </Trace>
);

export const IconEngagement: Icone = (props) => (
  <Trace {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </Trace>
);

export const IconRegles: Icone = (props) => (
  <Trace {...props}>
    <path d="M4 6h16M4 12h16M4 18h16" />
    <circle cx="9" cy="6" r="2" />
    <circle cx="15" cy="12" r="2" />
    <circle cx="8" cy="18" r="2" />
  </Trace>
);

export const IconFormulaire: Icone = (props) => (
  <Trace {...props}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M8.5 8h7M8.5 12h7M8.5 16h4" />
  </Trace>
);

export const IconNotification: Icone = (props) => (
  <Trace {...props}>
    <path d="M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5Z" />
    <path d="M13.7 19a2 2 0 0 1-3.4 0" />
  </Trace>
);

export const IconCourriel: Icone = (props) => (
  <Trace {...props}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3.5 7 7.4 5.3a2 2 0 0 0 2.2 0L20.5 7" />
  </Trace>
);

export const IconEnquete: Icone = (props) => (
  <Trace {...props}>
    <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9Z" />
  </Trace>
);

export const IconSoleil: Icone = (props) => (
  <Trace {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Trace>
);

export const IconLune: Icone = (props) => (
  <Trace {...props}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
  </Trace>
);

export const IconEcran: Icone = (props) => (
  <Trace {...props}>
    <rect x="2.5" y="4" width="19" height="13" rx="2" />
    <path d="M8.5 21h7M12 17v4" />
  </Trace>
);

export const IconMenu: Icone = (props) => (
  <Trace {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Trace>
);

export const IconFermer: Icone = (props) => (
  <Trace {...props}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Trace>
);

export const IconSortie: Icone = (props) => (
  <Trace {...props}>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
    <path d="M10 8.5 6.5 12 10 15.5M6.5 12H15" />
  </Trace>
);

export const IconPlus: Icone = (props) => (
  <Trace {...props}>
    <path d="M12 5v14M5 12h14" />
  </Trace>
);

export const IconChevron: Icone = (props) => (
  <Trace {...props}>
    <path d="m9 6 6 6-6 6" />
  </Trace>
);

export const IconRetour: Icone = (props) => (
  <Trace {...props}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Trace>
);

export const IconTelecharger: Icone = (props) => (
  <Trace {...props}>
    <path d="M12 3v11M8 10.5l4 4 4-4" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </Trace>
);

export const IconLien: Icone = (props) => (
  <Trace {...props}>
    <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7l-1.3 1.3" />
    <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.3 2.3a4 4 0 0 0 5.7 5.7l1.3-1.3" />
  </Trace>
);
