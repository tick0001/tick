import type { SessionContext } from '@tick/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { rendre } from '@/test/rendu';
import { ContextSwitcher } from './ContextSwitcher';

/**
 * Le sélecteur d'entité et de profil actifs.
 *
 * C'est le point où l'application change de périmètre, et donc l'endroit le
 * plus dangereux de l'interface : les données affichées viennent de l'entité
 * précédente, et les laisser en place ne serait-ce qu'un instant montrerait à
 * quelqu'un ce qu'il n'a plus le droit de voir.
 *
 * Chaque option est une **habilitation** — un couple entité + profil, jamais
 * l'un sans l'autre. Le même utilisateur peut être technicien sur une branche
 * et simple demandeur sur une autre.
 */

function entite(id: number, nom: string) {
  return { id, name: nom, completeName: nom, path: `e${String(id)}`, level: 0, parentId: null };
}

const SESSION: SessionContext = {
  user: { id: 1, username: 'admin', displayName: 'Alice Martin', email: null, locale: 'fr' },
  entity: entite(1, 'Racine'),
  profile: { id: 1, name: 'Super-Admin', interface: 'standard' },
  includeSubEntities: true,
  rights: {},
  available: [
    {
      entity: entite(1, 'Racine'),
      profile: { id: 1, name: 'Super-Admin', interface: 'standard' },
      isRecursive: true,
    },
    {
      entity: entite(2, 'Nord'),
      profile: { id: 2, name: 'Technicien', interface: 'standard' },
      isRecursive: true,
    },
  ],
};

describe('ContextSwitcher', () => {
  beforeEach(() => {
    vi.spyOn(api, 'switchContext').mockResolvedValue({
      ...SESSION,
      entity: entite(2, 'Nord'),
      profile: { id: 2, name: 'Technicien', interface: 'standard' },
    });
  });

  it('propose une option par habilitation', () => {
    rendre(<ContextSwitcher session={SESSION} />);

    expect(screen.getByRole('option', { name: 'Racine — Super-Admin' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Nord — Technicien' })).toBeInTheDocument();
  });

  it('montre l’habilitation courante', () => {
    rendre(<ContextSwitcher session={SESSION} />);

    expect(screen.getByRole('combobox')).toHaveValue('1:1');
  });

  it('bascule sur le couple entité + profil choisi', async () => {
    rendre(<ContextSwitcher session={SESSION} />);

    await userEvent.selectOptions(screen.getByRole('combobox'), '2:2');

    // Le profil accompagne l'entite : basculer sur l'un sans l'autre laisserait
    // des droits d'administration sur une branche ou l'on n'est que demandeur.
    await waitFor(() => {
      expect(api.switchContext).toHaveBeenCalledWith({
        entityId: 2,
        profileId: 2,
        includeSubEntities: true,
      });
    });
  });

  it('vide le cache des autres requêtes en changeant de périmètre', async () => {
    const { client } = rendre(<ContextSwitcher session={SESSION} />);

    client.setQueryData(['tickets'], { items: [{ id: 1, name: 'Ticket de Racine' }] });
    client.setQueryData(['session'], SESSION);

    await userEvent.selectOptions(screen.getByRole('combobox'), '2:2');

    // Les invalider ne suffirait pas : le cache resterait affiche pendant le
    // rechargement, et le resterait si la nouvelle requete est refusee. On
    // supprime, pour qu'il soit impossible de voir un instant les donnees d'une
    // entite qu'on vient de quitter.
    await waitFor(() => {
      expect(client.getQueryData(['tickets'])).toBeUndefined();
    });

    expect(client.getQueryData(['session'])).toMatchObject({ entity: { name: 'Nord' } });
  });

  it('se désactive quand il n’y a rien à choisir', () => {
    rendre(<ContextSwitcher session={{ ...SESSION, available: [SESSION.available[0]!] }} />);

    // Un selecteur a une seule option laisse croire qu'on peut changer de
    // perimetre : le desactiver dit la verite sans phrase supplementaire.
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('signale l’inclusion des sous-entités', () => {
    rendre(<ContextSwitcher session={SESSION} />);

    expect(screen.getByTitle(/sous-entit/i)).toBeInTheDocument();
  });

  it('n’affiche rien de tel quand le périmètre est exact', () => {
    rendre(<ContextSwitcher session={{ ...SESSION, includeSubEntities: false }} />);

    expect(screen.queryByTitle(/sous-entit/i)).not.toBeInTheDocument();
  });

  it('nomme le sélecteur pour les lecteurs d’écran', () => {
    rendre(<ContextSwitcher session={SESSION} />);

    // Sans etiquette, un lecteur d'ecran annonce « liste deroulante » sans dire
    // ce qu'elle change — ici, rien de moins que le perimetre de travail.
    expect(screen.getByRole('combobox', { name: /Changer d'entité ou de profil/ })).toBeInTheDocument();
  });
});
