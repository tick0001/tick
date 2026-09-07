import type { EntitySettings, EntitySummary, TicketTemplate } from '@tick/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { monterPage, sessionFactice, tousDroits } from '@/test/page';
import { SettingsPage } from './SettingsPage';

/**
 * Réglages par entité.
 *
 * Tout l'écran tient dans une distinction : une valeur est **posée ici** ou
 * **héritée d'un ancêtre**. « 7 jours » ne dit pas laquelle, et c'est pourtant
 * ce qu'il faut savoir avant d'y toucher — modifier une valeur héritée la
 * détache du parent, et elle cesse alors de suivre ses changements.
 *
 * D'où la seconde règle, qui est la seule façon de revenir en arrière :
 * `null` ne veut pas dire « vide » mais « rétablir l'héritage ». Envoyer une
 * chaîne vide poserait une valeur locale vide, ce qui n'est pas du tout la
 * même chose.
 */

const ENTITES: EntitySummary[] = [
  { id: 1, name: 'Racine', completeName: 'Racine', path: 'e1', level: 0, parentId: null },
  { id: 2, name: 'DSI', completeName: 'Racine > DSI', path: 'e1.e2', level: 1, parentId: 1 },
];

const REGLAGES: EntitySettings = {
  entityId: 1,
  entityName: 'Racine',
  settings: [
    // Posee ici : elle ne suit plus le parent.
    {
      key: 'autoCloseDelayDays',
      value: 7,
      origin: { id: 1, completeName: 'Racine' },
      isOwn: true,
    },
    // Heritee : elle suivra tout changement de la racine.
    {
      key: 'mailFrom',
      value: 'support@exemple.fr',
      origin: { id: 1, completeName: 'Racine' },
      isOwn: false,
    },
    // Nulle part dans l'arbre : le defaut du code s'applique.
    { key: 'mailReplyTo', value: null, origin: null, isOwn: false },
  ],
};

const GABARITS: TicketTemplate[] = [
  {
    id: 1,
    name: 'Incident standard',
    comment: null,
    entity: { id: 1, name: 'Racine' },
    isRecursive: true,
    predefined: {},
    mandatory: [],
    hidden: [],
  },
];

const DROITS = tousDroits(['entity']);
const SESSION = sessionFactice(DROITS);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'entities').mockResolvedValue(ENTITES);
  vi.spyOn(api, 'templates').mockResolvedValue(GABARITS);
  vi.spyOn(api, 'entitySettings').mockResolvedValue(REGLAGES);
});

describe('SettingsPage', () => {
  it('dit de chaque valeur si elle est posée ici ou héritée', async () => {
    monterPage(<SettingsPage session={SESSION} />, { droits: DROITS });

    expect(await screen.findByText(/posé ici/)).toBeInTheDocument();

    // « Herite de Racine » et non « Racine » : l'origine est ce qu'il faut
    // savoir avant de modifier, puisque toucher a une valeur heritee la detache
    // definitivement du parent.
    expect(screen.getByText(/hérité de Racine/)).toBeInTheDocument();
  });

  it('signale une valeur absente de tout l’arbre', async () => {
    monterPage(<SettingsPage session={SESSION} />, { droits: DROITS });

    // Ni posee ni heritee : c'est le defaut du code qui s'applique, et le dire
    // evite de croire a un reglage oublie. Toutes les cles absentes du jeu
    // d'essai sont dans ce cas.
    expect((await screen.findAllByText(/défaut du code/)).length).toBeGreaterThan(0);
  });

  it('n’envoie que ce qui a été modifié', async () => {
    const utilisateur = userEvent.setup();
    const ecrire = vi.spyOn(api, 'writeEntitySettings').mockResolvedValue(REGLAGES);

    monterPage(<SettingsPage session={SESSION} />, { droits: DROITS });

    const delai = await screen.findByDisplayValue('7');

    await utilisateur.clear(delai);
    await utilisateur.type(delai, '14');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => {
      expect(ecrire).toHaveBeenCalled();
    });

    // Les cles absentes ne sont pas touchees : envoyer tout l'ecran poserait
    // localement des valeurs qu'on n'a fait que regarder, et les detacherait
    // de leur parent sans le vouloir.
    const [, corps] = ecrire.mock.calls[0]!;

    expect(corps.autoCloseDelayDays).toBe(14);
    expect(Object.keys(corps)).toEqual(['autoCloseDelayDays']);
  });

  it('rétablit l’héritage en envoyant null, et non une valeur vide', async () => {
    const utilisateur = userEvent.setup();
    const ecrire = vi.spyOn(api, 'writeEntitySettings').mockResolvedValue(REGLAGES);

    monterPage(<SettingsPage session={SESSION} />, { droits: DROITS });
    await screen.findByDisplayValue('7');

    await utilisateur.click(screen.getByRole('button', { name: /Rétablir l’héritage/ }));
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => {
      expect(ecrire).toHaveBeenCalled();
    });

    // `null` est la seule facon de revenir au comportement du parent : une
    // chaine vide poserait une valeur locale vide, ce qui n'a rien a voir.
    const [, corps] = ecrire.mock.calls[0]!;

    expect(corps.autoCloseDelayDays).toBeNull();
  });

  it('repart de zéro en changeant d’entité', async () => {
    const utilisateur = userEvent.setup();
    const lire = vi.spyOn(api, 'entitySettings');

    monterPage(<SettingsPage session={SESSION} />, { droits: DROITS });

    const delai = await screen.findByDisplayValue('7');

    await utilisateur.clear(delai);
    await utilisateur.type(delai, '30');

    await utilisateur.selectOptions(screen.getByDisplayValue('Racine'), '2');

    // Garder les modifications non enregistrees les appliquerait a une entite
    // que l'utilisateur n'a pas encore regardee.
    await waitFor(() => {
      expect(lire).toHaveBeenCalledWith(2);
    });

    expect(await screen.findByDisplayValue('7')).toBeInTheDocument();
  });

  it('cache l’enregistrement à qui n’a pas le droit d’écrire', async () => {
    const lecture = sessionFactice({ 'entity:read': 'all' });

    monterPage(<SettingsPage session={lecture} />, { droits: { 'entity:read': 'all' } });

    await screen.findByText(/posé ici/);

    expect(screen.queryByRole('button', { name: 'Enregistrer' })).not.toBeInTheDocument();
  });

  it('affiche le refus du serveur plutôt que de l’avaler', async () => {
    const utilisateur = userEvent.setup();

    vi.spyOn(api, 'writeEntitySettings').mockRejectedValue(new ApiError(400, 'Adresse invalide.'));

    monterPage(<SettingsPage session={SESSION} />, { droits: DROITS });

    const delai = await screen.findByDisplayValue('7');

    await utilisateur.clear(delai);
    await utilisateur.type(delai, '9');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText('Adresse invalide.')).toBeInTheDocument();
  });
});
