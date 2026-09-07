import type { ItilCategory, TicketDetail, TicketTemplate } from '@tick/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { monterPage, tousDroits } from '@/test/page';
import { NewTicketPage } from './NewTicketPage';

/**
 * Ouverture d'un ticket.
 *
 * Le gabarit fait trois choses distinctes, et c'est ce que ces tests séparent :
 * il **préremplit** des valeurs, il en rend certaines **obligatoires**, et il
 * en **cache** d'autres. Confondre « caché » et « obligatoire » produirait un
 * formulaire qu'on ne peut pas soumettre sans pouvoir voir pourquoi.
 *
 * La catégorie disparaît quand le référentiel de l'entité est vide : proposer
 * une liste déroulante sans option se lit comme une panne.
 */

const GABARITS: TicketTemplate[] = [
  {
    id: 1,
    name: 'Panne matérielle',
    comment: null,
    entity: { id: 1, name: 'Racine' },
    isRecursive: true,
    // Prerempli : le type et l'urgence sont poses d'avance.
    predefined: { type: 'incident', urgency: 4 },
    mandatory: ['content'],
    hidden: ['impact'],
  },
  {
    id: 2,
    name: 'Demande simple',
    comment: null,
    entity: { id: 1, name: 'Racine' },
    isRecursive: true,
    predefined: {},
    mandatory: [],
    hidden: [],
  },
];

const CATEGORIES: ItilCategory[] = [
  { id: 3, name: 'Impression', completeName: 'Matériel > Impression', parentId: 1, level: 1 },
];

const TICKET = { id: 42 } as TicketDetail;

const DROITS = tousDroits(['ticket']);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'templates').mockResolvedValue(GABARITS);
  vi.spyOn(api, 'itilCategories').mockResolvedValue(CATEGORIES);
});

describe('NewTicketPage', () => {
  it('propose les gabarits du périmètre', async () => {
    monterPage(<NewTicketPage />, { droits: DROITS });

    expect(await screen.findByRole('option', { name: 'Panne matérielle' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Demande simple' })).toBeInTheDocument();
  });

  it('préremplit, rend obligatoire et cache ce que le gabarit décide', async () => {
    const utilisateur = userEvent.setup();

    monterPage(<NewTicketPage />, { droits: DROITS });

    const choix = await screen.findByRole('option', { name: 'Panne matérielle' });

    await utilisateur.selectOptions(choix.closest('select')!, '1');

    // Prerempli : l'urgence passe a 4 sans que personne ne la choisisse.
    await waitFor(() => {
      expect(screen.getByLabelText(/Urgence/)).toHaveValue('4');
    });

    // Cache : l'impact ne se regle pas sur ce type de demande.
    expect(screen.queryByLabelText(/Impact/)).not.toBeInTheDocument();

    // Obligatoire : la description porte l'asterisque, et le champ l'exige.
    expect(screen.getByLabelText(/Description/)).toBeRequired();
  });

  it('cache la catégorie quand le référentiel de l’entité est vide', async () => {
    vi.spyOn(api, 'itilCategories').mockResolvedValue([]);

    monterPage(<NewTicketPage />, { droits: DROITS });

    await screen.findByLabelText(/Sujet/);

    // Une liste deroulante sans option se lit comme une panne : mieux vaut ne
    // pas offrir le champ que d'offrir un choix vide.
    expect(screen.queryByLabelText(/Catégorie/)).not.toBeInTheDocument();
  });

  it('affiche la catégorie par son nom complet', async () => {
    monterPage(<NewTicketPage />, { droits: DROITS });

    // « Impression » seul serait indistinguable d'une branche a l'autre.
    expect(
      await screen.findByRole('option', { name: 'Matériel > Impression' }),
    ).toBeInTheDocument();
  });

  it('crée le ticket avec le gabarit retenu', async () => {
    const utilisateur = userEvent.setup();
    const creer = vi.spyOn(api, 'createTicket').mockResolvedValue(TICKET);

    monterPage(<NewTicketPage />, { droits: DROITS });

    await utilisateur.type(await screen.findByLabelText(/Sujet/), 'Écran noir');
    await utilisateur.type(screen.getByLabelText(/Description/), 'Depuis ce matin');

    const gabarits = screen.getByRole('option', { name: 'Panne matérielle' }).closest('select')!;

    await utilisateur.selectOptions(gabarits, '1');
    await utilisateur.click(screen.getByRole('button', { name: /Créer le ticket/ }));

    // Le gabarit accompagne la creation : le serveur en a besoin pour appliquer
    // ce que l'ecran n'affiche pas -- acteurs par defaut, categorie imposee.
    await waitFor(() => {
      expect(creer).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Écran noir', templateId: 1, type: 'incident' }),
      );
    });
  });

  it('crée sans gabarit quand aucun n’est choisi', async () => {
    const utilisateur = userEvent.setup();
    const creer = vi.spyOn(api, 'createTicket').mockResolvedValue(TICKET);

    monterPage(<NewTicketPage />, { droits: DROITS });

    await utilisateur.type(await screen.findByLabelText(/Sujet/), 'Question');
    await utilisateur.type(screen.getByLabelText(/Description/), 'Simple demande');
    await utilisateur.click(screen.getByRole('button', { name: /Créer le ticket/ }));

    await waitFor(() => {
      expect(creer).toHaveBeenCalled();
    });

    // `templateId` absent, et non nul : le contrat distingue « pas de gabarit »
    // d'un gabarit dont l'identifiant serait zero.
    expect(creer.mock.calls[0]![0]).not.toHaveProperty('templateId');
  });

  it('montre le refus du serveur plutôt que de perdre la saisie', async () => {
    const utilisateur = userEvent.setup();

    vi.spyOn(api, 'createTicket').mockRejectedValue(new ApiError(400, 'Categorie obligatoire.'));

    monterPage(<NewTicketPage />, { droits: DROITS });

    await utilisateur.type(await screen.findByLabelText(/Sujet/), 'Écran noir');
    await utilisateur.type(screen.getByLabelText(/Description/), 'Depuis ce matin');
    await utilisateur.click(screen.getByRole('button', { name: /Créer le ticket/ }));

    expect(await screen.findByText('Categorie obligatoire.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Sujet/)).toHaveValue('Écran noir');
  });
});
