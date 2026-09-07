import type { Agreement, Calendar } from '@tick/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { monterPage, tousDroits } from '@/test/page';
import { ServiceLevelsPage } from './ServiceLevelsPage';

/**
 * Calendriers et engagements de service.
 *
 * Les deux vivent sur le même écran parce qu'ils ne se comprennent pas l'un
 * sans l'autre : une échéance de quatre heures ne veut rien dire tant qu'on ne
 * sait pas si le samedi compte. C'est ce lien que ces tests surveillent — la
 * durée s'affiche et se saisit en **heures** alors que le contrat la porte en
 * secondes, et un calendrier absent signifie « 24/7 », pas « pas de calendrier ».
 */

const CALENDRIER: Calendar = {
  id: 1,
  name: 'Heures ouvrées',
  comment: null,
  timezone: 'Europe/Paris',
  entityId: 1,
  entityName: 'Racine',
  isRecursive: true,
  segments: [{ weekday: 1, beginAt: '09:00', endAt: '18:00' }],
  holidays: [{ name: 'Noël', day: '2026-12-25', isPerpetual: true }],
};

const ENGAGEMENTS: Agreement[] = [
  {
    id: 10,
    kind: 'sla',
    axis: 'ttr',
    name: 'Résolution critique',
    comment: null,
    // Quatre heures, portees en secondes par le contrat.
    duration: 14_400,
    calendarId: 1,
    calendarName: 'Heures ouvrées',
    entityId: 1,
    entityName: 'Racine',
    isRecursive: true,
    levels: [
      { name: 'Relance', offsetSeconds: -3600, isActive: true, actions: [] },
      { name: 'Escalade', offsetSeconds: 7200, isActive: true, actions: [] },
    ],
  },
  {
    id: 11,
    kind: 'ola',
    axis: 'tto',
    name: 'Prise en charge interne',
    comment: null,
    duration: 3600,
    // Sans calendrier : le temps court en continu.
    calendarId: null,
    calendarName: null,
    entityId: 1,
    entityName: 'Racine',
    isRecursive: false,
    levels: [],
  },
];

const DROITS = tousDroits(['slm']);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'calendars').mockResolvedValue([CALENDRIER]);
  vi.spyOn(api, 'agreements').mockResolvedValue(ENGAGEMENTS);
});

describe('ServiceLevelsPage', () => {
  it('affiche les durées en heures et nomme le calendrier de chaque engagement', async () => {
    monterPage(<ServiceLevelsPage />, { droits: DROITS });

    expect(await screen.findByText('Résolution critique')).toBeInTheDocument();

    // 14 400 secondes se lisent « 4 h » : personne ne compose un engagement en
    // secondes, et l'afficher ainsi obligerait a diviser de tete.
    expect(screen.getByText(/4 h · Heures ouvrées/)).toBeInTheDocument();

    // Pas de calendrier ne veut pas dire « aucun » mais « en continu » : le
    // laisser vide ferait croire a un reglage oublie.
    expect(screen.getByText(/Temps calendaire/)).toBeInTheDocument();
  });

  it('détaille les niveaux d’escalade, avant et après l’échéance', async () => {
    monterPage(<ServiceLevelsPage />, { droits: DROITS });

    await screen.findByText('Résolution critique');

    // Le signe du decalage porte tout le sens : -3600 est une relance avant
    // l'echeance, +7200 une escalade apres. Afficher « -1 h » laisserait le
    // lecteur interpreter.
    expect(screen.getByText(/Relance — 1 h avant/)).toBeInTheDocument();
    expect(screen.getByText(/Escalade — 2 h après/)).toBeInTheDocument();
  });

  it('montre les plages et les jours fériés du calendrier à la modification', async () => {
    const utilisateur = userEvent.setup();

    monterPage(<ServiceLevelsPage />, { droits: DROITS });
    await screen.findByText('Heures ouvrées');

    await utilisateur.click(screen.getAllByRole('button', { name: 'Modifier' })[0]!);

    expect(await screen.findByDisplayValue('Heures ouvrées')).toBeInTheDocument();
    expect(screen.getByDisplayValue('09:00')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Noël')).toBeInTheDocument();
  });

  it('reconvertit la durée en secondes à l’enregistrement', async () => {
    const utilisateur = userEvent.setup();
    const enregistrer = vi.spyOn(api, 'saveAgreement').mockResolvedValue(ENGAGEMENTS[0]!);

    monterPage(<ServiceLevelsPage />, { droits: DROITS });
    await screen.findByText('Résolution critique');

    const modifier = screen.getAllByRole('button', { name: 'Modifier' });

    // Le second bloc « Modifier » est celui des engagements : le premier
    // appartient au calendrier, liste au-dessus.
    await utilisateur.click(modifier[1]!);

    const duree = await screen.findByDisplayValue('4');

    // `fireEvent` plutot que de vider puis retaper : le champ ne peut pas
    // rester vide -- il retombe a 1 h -- si bien qu'une saisie caractere par
    // caractere produirait « 1 » puis « 18 ».
    fireEvent.change(duree, { target: { value: '8' } });

    await utilisateur.click(screen.getAllByRole('button', { name: 'Enregistrer' })[0]!);

    await waitFor(() => {
      expect(enregistrer).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Résolution critique', duration: 28_800 }),
        10,
      );
    });
  });

  it('refuse une durée nulle et retombe sur une heure', async () => {
    const utilisateur = userEvent.setup();

    monterPage(<ServiceLevelsPage />, { droits: DROITS });
    await screen.findByText('Résolution critique');

    await utilisateur.click(screen.getAllByRole('button', { name: 'Modifier' })[1]!);

    const duree = await screen.findByDisplayValue('4');

    // Un engagement de duree nulle serait deja en retard a sa creation : le
    // champ plancher a une heure plutot que de laisser passer zero.
    fireEvent.change(duree, { target: { value: '' } });

    expect(duree).toHaveValue(1);
  });

  it('propose les calendriers du périmètre, et le temps continu', async () => {
    const utilisateur = userEvent.setup();

    monterPage(<ServiceLevelsPage />, { droits: DROITS });
    await screen.findByText('Résolution critique');

    await utilisateur.click(screen.getAllByRole('button', { name: 'Modifier' })[1]!);

    // La liste des calendriers se reconnait a son option « temps calendaire » :
    // les autres listes du formulaire -- nature, axe -- ne la portent pas.
    const calendrier = await waitFor(() => {
      const trouvee = screen
        .getAllByRole('combobox')
        .find((liste) => within(liste).queryByRole('option', { name: /Temps calendaire/ }));

      expect(trouvee).toBeDefined();

      return trouvee!;
    });

    // Le temps continu est une option a part entiere, pas l'absence de choix :
    // un engagement sans calendrier court 24 h sur 24.
    expect(within(calendrier).getByRole('option', { name: 'Heures ouvrées' })).toBeInTheDocument();
    expect(calendrier).toHaveValue('1');
  });

  it('supprime un calendrier et un engagement', async () => {
    const utilisateur = userEvent.setup();
    const calendrier = vi.spyOn(api, 'deleteCalendar').mockResolvedValue(undefined);
    const engagement = vi.spyOn(api, 'deleteAgreement').mockResolvedValue(undefined);

    monterPage(<ServiceLevelsPage />, { droits: DROITS });
    await screen.findByText('Résolution critique');

    const supprimer = screen.getAllByRole('button', { name: 'Supprimer' });

    await utilisateur.click(supprimer[0]!);
    await utilisateur.click(supprimer[1]!);

    await waitFor(() => {
      expect(calendrier.mock.calls[0]?.[0]).toBe(1);
      expect(engagement.mock.calls[0]?.[0]).toBe(10);
    });
  });

  it('cache les créations à qui n’a pas le droit d’écrire', async () => {
    monterPage(<ServiceLevelsPage />, { droits: { 'slm:read': 'all' } });

    await screen.findByText('Résolution critique');

    expect(screen.queryByRole('button', { name: 'Nouveau calendrier' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nouvel engagement' })).not.toBeInTheDocument();
  });

  it('refuse l’écran à qui n’a pas le droit de lire', async () => {
    vi.spyOn(api, 'calendars').mockRejectedValue(new ApiError(403, 'Interdit'));

    monterPage(<ServiceLevelsPage />, { droits: DROITS });

    expect(await screen.findByText(/ne permet pas/i)).toBeInTheDocument();
  });

  it('affiche le refus du serveur plutôt que de l’avaler', async () => {
    const utilisateur = userEvent.setup();

    vi.spyOn(api, 'saveCalendar').mockRejectedValue(new ApiError(400, 'Fuseau inconnu.'));

    monterPage(<ServiceLevelsPage />, { droits: DROITS });
    await screen.findByText('Heures ouvrées');

    await utilisateur.click(screen.getAllByRole('button', { name: 'Modifier' })[0]!);
    await utilisateur.click(screen.getAllByRole('button', { name: 'Enregistrer' })[0]!);

    expect(await screen.findByText('Fuseau inconnu.')).toBeInTheDocument();
  });
});
