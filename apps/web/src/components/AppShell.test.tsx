import type { SessionContext } from '@tick/contracts';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SessionProvider } from '@/lib/session';
import { rendre } from '@/test/rendu';
import { AppShell } from './AppShell';

/**
 * Ce que la barre de navigation propose.
 *
 * Une entrée qui mène à un refus se lit comme une panne, pas comme une absence
 * de droit : l'utilisateur clique, voit un message rouge, et croit l'outil
 * cassé. Elle ne doit donc pas s'afficher.
 *
 * Ce n'est pas un contrôle d'accès — le serveur refuse déjà, et c'est lui qui
 * fait autorité. C'est une question de sincérité de l'écran : ne pas annoncer
 * une porte murée.
 */

function session(rights: SessionContext['rights'], profil = 'standard' as const): SessionContext {
  return {
    user: { id: 1, username: 'thomas', displayName: 'Thomas Petit', email: null, locale: 'fr' },
    entity: { id: 1, name: 'DSI', completeName: 'DSI', path: 'e1', level: 0, parentId: null },
    profile: { id: 3, name: 'Technicien', interface: profil },
    includeSubEntities: true,
    rights,
    available: [],
  };
}

function monter(courante: SessionContext, route = '/tickets') {
  return rendre(
    <SessionProvider session={courante}>
      <AppShell session={courante} onLogout={vi.fn()}>
        <p>contenu</p>
      </AppShell>
    </SessionProvider>,
    { route },
  );
}

const TECHNICIEN: SessionContext['rights'] = {
  'ticket:read': 'entity',
  'ticket:update': 'group',
  'problem:read': 'entity',
  'planning:read': 'entity',
  'stats:read': 'entity',
  'kb:read': 'entity',
};

describe('AppShell — navigation', () => {
  it('propose ce que le profil peut ouvrir', () => {
    monter(session(TECHNICIEN));

    expect(screen.getByRole('link', { name: /Tickets/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Problèmes/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Planning/ })).toBeInTheDocument();
  });

  it('retire ce qu’il ne peut pas ouvrir', () => {
    monter(session(TECHNICIEN));

    // Le technicien de reference n'a pas `change:read` : l'entree disparait
    // plutot que de mener a un refus.
    expect(screen.queryByRole('link', { name: /Changements/ })).not.toBeInTheDocument();
  });

  it('cache la configuration à qui n’y a aucun écran', () => {
    monter(session(TECHNICIEN));

    // Proposer une zone dont tous les ecrans sont refuses reviendrait a
    // annoncer une porte muree.
    expect(screen.queryByRole('link', { name: /Configuration/ })).not.toBeInTheDocument();
  });

  it('ouvre la configuration dès qu’un seul écran est accessible', () => {
    monter(session({ ...TECHNICIEN, 'rule:read': 'entity' }));

    expect(screen.getByRole('link', { name: /Configuration/ })).toBeInTheDocument();
  });

  it('ne montre dans la configuration que les écrans permis', () => {
    monter(session({ ...TECHNICIEN, 'rule:read': 'entity' }), '/settings/rules');

    expect(screen.getByRole('link', { name: /Règles/ })).toBeInTheDocument();

    // Ni comptes, ni profils, ni annuaires : ce sont des tables globales, et
    // les proposer a un technicien laisserait croire qu'il les administre.
    expect(screen.queryByRole('link', { name: /Utilisateurs/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Profils/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Annuaires/ })).not.toBeInTheDocument();
  });

  it('efface un groupe entier devenu vide', () => {
    // Ni recherche ni statistiques : la recherche interroge les tickets, elle
    // suit donc `ticket:read`, et les deux entrees du groupe tombent ensemble.
    monter(session({ 'kb:read': 'entity' }));

    // Un titre de rubrique sans entree ne mene nulle part : il se lit comme un
    // chargement qui n'aboutit pas.
    expect(screen.queryByText('Analyse')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Statistiques/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Recherche/ })).not.toBeInTheDocument();
  });

  it('garde la recherche tant que les tickets sont lisibles', () => {
    monter(session({ 'ticket:read': 'own' }));

    expect(screen.getByRole('link', { name: /Recherche/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Statistiques/ })).not.toBeInTheDocument();
  });

  it('sert un profil complet sans rien retirer', () => {
    monter(
      session({
        'ticket:read': 'all',
        'problem:read': 'all',
        'change:read': 'all',
        'planning:read': 'all',
        'stats:read': 'all',
        'kb:read': 'all',
        'rule:read': 'all',
        'user:read': 'all',
      }),
    );

    for (const entree of [/Tickets/, /Problèmes/, /Changements/, /Planning/, /Statistiques/]) {
      expect(screen.getByRole('link', { name: entree })).toBeInTheDocument();
    }

    expect(screen.getByRole('link', { name: /Configuration/ })).toBeInTheDocument();
  });

  it('laisse le catalogue ouvert à tous', () => {
    monter(session({ 'ticket:read': 'own' }));

    // Remplir un formulaire est ce que fait un demandeur : le subordonner a un
    // droit fermerait la porte qu'on vient d'ouvrir.
    expect(screen.getByRole('link', { name: /Catalogue/ })).toBeInTheDocument();
  });
});
