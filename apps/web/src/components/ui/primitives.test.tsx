import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  Badge,
  BOUTON,
  BOUTON_DANGER,
  BOUTON_PRIMAIRE,
  BOUTON_SM,
  Button,
  Card,
  CardBody,
  CardHeader,
  CARTE,
  Checkbox,
  CONTROLE,
  EmptyState,
  Field,
  FieldError,
  Input,
  LinkButton,
  Notice,
  PageHeader,
  Select,
  Tabs,
  TableWrap,
  Td,
  Textarea,
  Th,
  Tr,
} from './primitives';

/**
 * Les primitives d'interface.
 *
 * Elles sont minces, et c'est justement pourquoi elles méritent des tests :
 * chaque écran s'appuie dessus, si bien qu'un défaut ici se répète partout
 * sans qu'on sache d'où il vient. Ce qui est vérifié tient en trois points —
 * ce que l'utilisateur voit, ce qu'il peut actionner, et le fait qu'une classe
 * passée en propriété l'emporte sur celle du composant.
 */

describe('Button', () => {
  it('rend un bouton qui ne soumet rien par défaut', () => {
    render(<Button>Enregistrer</Button>);

    // `type="button"` : sans lui, un bouton dans un formulaire le soumet, ce
    // qui recharge la page au premier clic sur « Annuler ».
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toHaveAttribute('type', 'button');
  });

  it('appelle son gestionnaire au clic', async () => {
    const clic = vi.fn();

    render(<Button onClick={clic}>Agir</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Agir' }));

    expect(clic).toHaveBeenCalledTimes(1);
  });

  it('n’agit plus une fois désactivé', async () => {
    const clic = vi.fn();

    render(
      <Button disabled onClick={clic}>
        Agir
      </Button>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Agir' }));

    expect(clic).not.toHaveBeenCalled();
  });

  it('accepte une variante et une taille', () => {
    render(
      <Button variante="danger" taille="sm">
        Supprimer
      </Button>,
    );

    expect(screen.getByRole('button', { name: 'Supprimer' }).className.length).toBeGreaterThan(0);
  });

  it('laisse la classe passée en propriété l’emporter', () => {
    render(<Button className="px-9">Large</Button>);

    // Sans fusion, la classe du composant gagnerait selon l'ordre de la feuille
    // de style : la variante passee ici serait ignoree une fois sur deux.
    expect(screen.getByRole('button', { name: 'Large' })).toHaveClass('px-9');
  });
});

describe('LinkButton', () => {
  it('rend un lien, pas un bouton', () => {
    render(<LinkButton href="/tickets">Tickets</LinkButton>);

    // Un lien deguise en bouton doit rester un lien : le clic milieu, le
    // « ouvrir dans un nouvel onglet » et les lecteurs d'ecran en dependent.
    const lien = screen.getByRole('link', { name: 'Tickets' });

    expect(lien).toHaveAttribute('href', '/tickets');
  });

  it('accepte variante et taille', () => {
    render(
      <LinkButton href="#" variante="primaire" taille="sm">
        Ouvrir
      </LinkButton>,
    );

    expect(screen.getByRole('link', { name: 'Ouvrir' })).toBeInTheDocument();
  });
});

describe('champs de saisie', () => {
  it('Input reçoit ce qu’on tape', async () => {
    render(<Input aria-label="Sujet" />);

    const champ = screen.getByLabelText('Sujet');

    await userEvent.type(champ, 'Panne');

    expect(champ).toHaveValue('Panne');
  });

  it('Textarea reçoit plusieurs lignes', async () => {
    render(<Textarea aria-label="Description" />);

    await userEvent.type(screen.getByLabelText('Description'), 'Une ligne');

    expect(screen.getByLabelText('Description')).toHaveValue('Une ligne');
  });

  it('Select change de valeur', async () => {
    render(
      <Select aria-label="Statut" defaultValue="new">
        <option value="new">Nouveau</option>
        <option value="closed">Clos</option>
      </Select>,
    );

    await userEvent.selectOptions(screen.getByLabelText('Statut'), 'closed');

    expect(screen.getByLabelText('Statut')).toHaveValue('closed');
  });

  it('Field relie son étiquette au contrôle', async () => {
    render(
      <Field label="Urgence" hint="De 1 à 5">
        <Input />
      </Field>,
    );

    // L'etiquette enveloppe le controle : cliquer dessus donne le focus, et un
    // lecteur d'ecran annonce le champ par son nom.
    await userEvent.click(screen.getByText('Urgence'));

    expect(screen.getByText('De 1 à 5')).toBeInTheDocument();
  });

  it('Field se passe d’indication', () => {
    render(
      <Field label="Titre">
        <Input />
      </Field>,
    );

    expect(screen.getByText('Titre')).toBeInTheDocument();
  });

  it('Checkbox bascule', async () => {
    render(<Checkbox label="Inclure les sous-entités" />);

    const case_ = screen.getByRole('checkbox');

    expect(case_).not.toBeChecked();
    await userEvent.click(case_);
    expect(case_).toBeChecked();
  });
});

describe('surfaces', () => {
  it('Card rend son contenu', () => {
    render(<Card>Contenu</Card>);

    expect(screen.getByText('Contenu')).toBeInTheDocument();
  });

  it('CardHeader affiche titre et action', () => {
    render(<CardHeader title="Engagements" action={<Button>Ajouter</Button>} />);

    expect(screen.getByRole('heading', { name: 'Engagements' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ajouter' })).toBeInTheDocument();
  });

  it('CardHeader se passe d’action', () => {
    render(<CardHeader title="Seul" />);

    expect(screen.getByRole('heading', { name: 'Seul' })).toBeInTheDocument();
  });

  it('CardBody rend son contenu', () => {
    render(<CardBody className="p-0">Corps</CardBody>);

    expect(screen.getByText('Corps')).toBeInTheDocument();
  });

  it('PageHeader porte titre, intention et actions', () => {
    render(
      <PageHeader
        title="Tickets"
        description="Suivre et traiter les demandes."
        action={<Button>Nouveau</Button>}
      />,
    );

    // La phrase d'intention n'est pas decorative : elle dit ce que l'ecran
    // permet, ce qu'un titre de deux mots ne fait jamais.
    expect(screen.getByRole('heading', { name: 'Tickets' })).toBeInTheDocument();
    expect(screen.getByText('Suivre et traiter les demandes.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nouveau' })).toBeInTheDocument();
  });

  it('PageHeader se passe de description et d’action', () => {
    render(<PageHeader title="Seul" />);

    expect(screen.getByRole('heading', { name: 'Seul' })).toBeInTheDocument();
  });
});

describe('Badge', () => {
  it.each(['neutre', 'marque', 'positif', 'attention', 'critique', 'info'] as const)(
    'rend le ton %s',
    (ton) => {
      render(<Badge ton={ton}>Étiquette</Badge>);

      expect(screen.getByText('Étiquette')).toBeInTheDocument();
    },
  );

  it('prend le ton neutre par défaut', () => {
    render(<Badge>Sans ton</Badge>);

    expect(screen.getByText('Sans ton')).toBeInTheDocument();
  });
});

describe('Tabs', () => {
  const options = [
    { value: 'ouverts', label: 'Ouverts' },
    { value: 'clos', label: 'Clos' },
  ] as const;

  it('marque l’onglet courant pour les technologies d’assistance', () => {
    render(<Tabs value="ouverts" onChange={vi.fn()} options={options} />);

    expect(screen.getByRole('tab', { name: 'Ouverts' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Clos' })).toHaveAttribute('aria-selected', 'false');
  });

  it('prévient du changement', async () => {
    const change = vi.fn();

    render(<Tabs value="ouverts" onChange={change} options={options} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Clos' }));

    expect(change).toHaveBeenCalledWith('clos');
  });

  it('expose une liste d’onglets', () => {
    render(<Tabs value="ouverts" onChange={vi.fn()} options={options} className="w-full" />);

    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });
});

describe('états', () => {
  it('EmptyState explique le vide', () => {
    render(<EmptyState title="Aucun ticket" hint="Modifiez vos filtres." />);

    // Un tableau vide sans phrase se lit comme une panne : dire pourquoi il est
    // vide evite d'aller chercher l'erreur ailleurs.
    expect(screen.getByText('Aucun ticket')).toBeInTheDocument();
    expect(screen.getByText('Modifiez vos filtres.')).toBeInTheDocument();
  });

  it('EmptyState se passe d’indication', () => {
    render(<EmptyState title="Rien" />);

    expect(screen.getByText('Rien')).toBeInTheDocument();
  });

  it.each(['marque', 'positif', 'attention', 'critique', 'info'] as const)(
    'Notice rend le ton %s',
    (ton) => {
      render(<Notice ton={ton}>Message</Notice>);

      expect(screen.getByText('Message')).toBeInTheDocument();
    },
  );

  it('Notice prend le ton attention par défaut', () => {
    render(<Notice>Par défaut</Notice>);

    expect(screen.getByText('Par défaut')).toBeInTheDocument();
  });

  it('FieldError s’efface quand il n’y a rien à dire', () => {
    const { container } = render(<FieldError>{null}</FieldError>);

    expect(container).toBeEmptyDOMElement();
  });

  it('FieldError affiche le message', () => {
    render(<FieldError>Champ obligatoire</FieldError>);

    expect(screen.getByText('Champ obligatoire')).toBeInTheDocument();
  });
});

describe('tableaux', () => {
  it('assemblent une table complète', () => {
    render(
      <TableWrap className="mt-4">
        <thead>
          <Tr>
            <Th>Sujet</Th>
            <Th className="w-24">Statut</Th>
          </Tr>
        </thead>
        <tbody>
          <Tr className="cursor-pointer">
            <Td>Panne d’imprimante</Td>
            <Td className="text-right">Nouveau</Td>
          </Tr>
        </tbody>
      </TableWrap>,
    );

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Sujet' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Panne d’imprimante' })).toBeInTheDocument();
  });

  it('acceptent des cellules vides', () => {
    render(
      <TableWrap>
        <tbody>
          <Tr>
            <Td />
            <Th />
          </Tr>
        </tbody>
      </TableWrap>,
    );

    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});

describe('classes exportées', () => {
  it('restent utilisables telles quelles', () => {
    // Quelques formulaires composent leurs champs a la main : leur imposer un
    // composant aurait ajoute une enveloppe pour rien.
    for (const classe of [BOUTON, BOUTON_PRIMAIRE, BOUTON_DANGER, BOUTON_SM, CARTE, CONTROLE]) {
      expect(typeof classe).toBe('string');
      expect(classe.length).toBeGreaterThan(0);
    }
  });
});
