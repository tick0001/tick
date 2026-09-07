import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Group,
  ItilCategory,
  UserSummary,
  Form,
  FormMapping,
  FormQuestion,
  FormQuestionKind,
  RuleOperator,
  UpsertForm,
} from '@tick/contracts';
import { KINDS_A_OPTIONS } from '@tick/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '@/lib/api';
import { FormPreview } from '@/components/FormPreview';
import { usePeut } from '@/lib/session';
import { cn } from '@/lib/utils';
import {
  Tabs,
  ACTION_LIGNE_DANGER,
  SectionTitle,
  PageHeader,
  ACTION_LIGNE,
  BOUTON,
  BOUTON_PRIMAIRE,
  CONTROLE,
} from '@/components/ui/primitives';

/**
 * Natures proposées à l'auteur, groupées comme dans GLPI.
 *
 * Le regroupement n'est pas décoratif : dix-neuf entrées dans une liste à plat
 * obligent à lire toute la liste pour trouver « Adresse électronique ». Les
 * familles disent d'emblée dans quelle direction chercher.
 *
 * `location` est déclarée au contrat mais absente d'ici : sa valeur se choisit
 * dans un référentiel que l'API n'expose pas encore en lecture. La proposer
 * donnerait une liste vide, ce qui se lit comme une panne — mieux vaut ne pas
 * l'offrir tant qu'elle ne peut pas tenir.
 */
const FAMILLES: {
  cle: 'saisie' | 'choix' | 'ticket' | 'information';
  natures: FormQuestionKind[];
}[] = [
  {
    cle: 'saisie',
    natures: ['text', 'textarea', 'number', 'date', 'time', 'datetime', 'email', 'url'],
  },
  { cle: 'choix', natures: ['select', 'radio', 'multiselect', 'checkbox'] },
  { cle: 'ticket', natures: ['urgency', 'requesttype', 'user', 'group'] },
  { cle: 'information', natures: ['description'] },
];

/** Opérateurs proposés pour une condition d'affichage. */
const OPERATEURS: RuleOperator[] = [
  'is',
  'is_not',
  'contains',
  'not_contains',
  'is_empty',
  'is_not_empty',
];

/**
 * Champs de ticket qu'une correspondance peut alimenter.
 *
 * La même liste que celle des actions de règle : ce sont les mêmes champs, et
 * deux listes finiraient par diverger sans que rien ne le signale.
 */
/**
 * Champs de ticket qu'une correspondance peut écrire, et la nature de leur
 * valeur.
 *
 * La nature décide de ce qu'on présente pour saisir une valeur fixe. Sans elle,
 * « affecter au groupe Logistique » se saisit en tapant `3` dans un champ
 * libre : personne ne connaît les identifiants, rien ne valide la frappe, et
 * l'erreur ne se découvre qu'au premier ticket créé au mauvais endroit.
 *
 * Les catégories, sources et lieux restent en saisie libre : l'API ne les
 * expose pas encore en liste. Le champ l'annonce plutôt que de faire semblant.
 */
const CHAMPS = [
  { champ: 'name', nature: 'texte' },
  { champ: 'content', nature: 'texte' },
  { champ: 'type', nature: 'type' },
  { champ: 'urgency', nature: 'severite' },
  { champ: 'impact', nature: 'severite' },
  { champ: 'categoryId', nature: 'categorie' },
  { champ: 'requestSourceId', nature: 'identifiant' },
  { champ: 'locationId', nature: 'identifiant' },
  { champ: 'assignedGroupId', nature: 'groupe' },
  { champ: 'assignedUserId', nature: 'utilisateur' },
  { champ: 'observerUserId', nature: 'utilisateur' },
] as const;

/**
 * Les champs du ticket, regroupes comme on les lit.
 *
 * Onze listes deroulantes a la suite ne se parcourent pas : on cherche
 * « groupe attribue » et l'on relit tout. Les trois familles repondent aux
 * trois questions qu'on se pose en composant une destination -- ce que le
 * ticket dira, comment il sera classe, et a qui il ira.
 */
const FAMILLES_CHAMPS = [
  { cle: 'contenu', champs: ['name', 'content'] },
  {
    cle: 'qualification',
    champs: ['type', 'urgency', 'impact', 'categoryId', 'requestSourceId', 'locationId'],
  },
  { cle: 'acteurs', champs: ['assignedGroupId', 'assignedUserId', 'observerUserId'] },
] as const;

type Nature = (typeof CHAMPS)[number]['nature'];

function natureDe(champ: string): Nature {
  return CHAMPS.find((entree) => entree.champ === champ)?.nature ?? 'texte';
}

function formulaireVide(): UpsertForm {
  return {
    name: '',
    description: null,
    category: null,
    isActive: true,
    ranking: 100,
    isRecursive: true,
    sections: [{ name: 'Questions', description: null, questions: [] }],
    access: [],
    destinations: [{ kind: 'ticket', mappings: [] }],
  };
}

function versFormulaire(forme: Form): UpsertForm {
  return {
    name: forme.name,
    description: forme.description,
    category: forme.category,
    isActive: forme.isActive,
    ranking: forme.ranking,
    isRecursive: forme.isRecursive,
    sections: forme.sections.map((section) => ({
      name: section.name,
      description: section.description,
      questions: section.questions.map((question) => ({ ...question })),
    })),
    access: forme.access.map((entree) => ({ ...entree })),
    destinations:
      forme.destinations.length > 0 ? forme.destinations : [{ kind: 'ticket', mappings: [] }],
  };
}

/** Questions à plat, avec leur rang : c'est ainsi que les conditions les désignent. */
function aplatir(valeurs: UpsertForm): { rang: number; question: FormQuestion }[] {
  let rang = -1;

  return valeurs.sections.flatMap((section) =>
    section.questions.map((question) => {
      rang += 1;

      return { rang, question };
    }),
  );
}

/**
 * Constructeur de formulaires.
 *
 * Les questions sont désignées par leur **rang** dans le formulaire, pas par un
 * identifiant : un formulaire se compose avant que ses questions existent en
 * base, et une condition doit pouvoir viser une question qui vient d'être
 * ajoutée.
 */
/**
 * Saisie d'une valeur fixe, adaptée à ce que le champ attend.
 *
 * Un groupe et un technicien se **choisissent** dans une liste : ce sont des
 * lignes de la base, et les désigner par un identifiant tapé à la main revient
 * à demander à l'administrateur d'aller le lire en SQL. Les sévérités et le
 * type sont des énumérations fermées, donc des listes elles aussi. Ne reste en
 * saisie libre que ce dont l'API ne publie pas encore la liste — et le champ
 * l'annonce, plutôt que de laisser croire à un texte quelconque.
 */
function ValeurFixe({
  nature,
  valeur,
  etiquette,
  groupes,
  comptes,
  categories,
  onChange,
}: {
  nature: Nature;
  valeur: string;
  /** Nom accessible : le champ dont ce controle regle la valeur. */
  etiquette?: string | undefined;
  groupes: readonly Group[];
  comptes: readonly UserSummary[];
  categories: readonly ItilCategory[];
  onChange: (valeur: string) => void;
}) {
  const { t } = useTranslation();

  // Le controle occupe la place qui reste sur sa ligne : une largeur fixe le
  // ferait deborder dans la colonne d'edition, etroite par construction
  // puisqu'elle partage l'ecran avec l'apercu.
  const classe = cn(CONTROLE, 'min-w-0 flex-1');

  const changer = (event: { target: { value: string } }): void => {
    onChange(event.target.value);
  };

  if (nature === 'groupe' || nature === 'utilisateur' || nature === 'categorie') {
    const entrees =
      nature === 'groupe'
        ? groupes.map((groupe) => ({ id: groupe.id, label: groupe.completeName }))
        : nature === 'categorie'
          ? categories.map((categorie) => ({ id: categorie.id, label: categorie.completeName }))
          : comptes.map((compte) => ({ id: compte.id, label: compte.displayName }));

    return (
      <select className={classe} aria-label={etiquette} value={valeur} onChange={changer}>
        <option value="">—</option>
        {entrees.map((entree) => (
          <option key={entree.id} value={String(entree.id)}>
            {entree.label}
          </option>
        ))}
      </select>
    );
  }

  if (nature === 'severite') {
    return (
      <select className={classe} aria-label={etiquette} value={valeur} onChange={changer}>
        <option value="">—</option>
        {[1, 2, 3, 4, 5].map((niveau) => (
          <option key={niveau} value={String(niveau)}>
            {/*
              Le niveau porte son nom, comme partout ailleurs. « 4 » seul
              obligeait a savoir de tete si l'echelle monte ou descend, et
              l'apercu du formulaire, lui, affichait deja « Haute ».
            */}
            {t(`tickets.priorites.p${String(niveau)}` as 'tickets.priorites.p1')}
          </option>
        ))}
      </select>
    );
  }

  if (nature === 'type') {
    return (
      <select className={classe} aria-label={etiquette} value={valeur} onChange={changer}>
        <option value="incident">{t('tickets.types.incident')}</option>
        <option value="request">{t('tickets.types.request')}</option>
      </select>
    );
  }

  return (
    <input
      className={classe}
      aria-label={etiquette}
      value={valeur}
      onChange={changer}
      {...(nature === 'identifiant'
        ? { inputMode: 'numeric' as const, placeholder: t('formulaires.identifiantAttendu') }
        : {})}
    />
  );
}

/**
 * Un champ du ticket, et d'où il tire sa valeur.
 *
 * L'écran présente **tous** les champs, plutôt qu'une liste de correspondances
 * qu'on ajoute une à une. Trois raisons, et la première est la plus lourde :
 * avec un bouton « ajouter », rien n'empêchait de viser deux fois le même
 * champ — la seconde correspondance écrasait silencieusement la première à la
 * soumission, sans que l'écran ne le laisse voir. Ensuite, une liste vide ne
 * disait pas ce qu'on pouvait remplir. Enfin, on lit d'un coup ce que la
 * soumission produira, ce qui est la question qu'on vient poser ici.
 */
function LigneDestination({
  champ,
  mapping,
  plates,
  groupes,
  comptes,
  categories,
  onChange,
}: {
  champ: string;
  mapping: FormMapping | undefined;
  plates: readonly { rang: number; question: FormQuestion }[];
  groupes: readonly Group[];
  comptes: readonly UserSummary[];
  categories: readonly ItilCategory[];
  onChange: (mapping: FormMapping | null) => void;
}) {
  const { t } = useTranslation();
  const mode = mapping?.source ?? 'defaut';
  const rempli = mapping !== undefined;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 border-l-2 py-1 pl-3',
        // Le filet dit d'un coup d'oeil ce qui est renseigne : parcourir onze
        // champs pour retrouver les trois qu'on a regles serait le travail que
        // cet ecran doit epargner.
        rempli ? 'border-brand' : 'border-line',
      )}
    >
      <span className="w-full text-[11px] font-semibold tracking-wider text-faint uppercase">
        {t(`formulaires.champs.${champ}` as 'formulaires.champs.name')}
      </span>

      <select
        className={cn(CONTROLE, 'w-32 shrink-0')}
        aria-label={t(`formulaires.champs.${champ}` as 'formulaires.champs.name')}
        value={mode}
        onChange={(event) => {
          const choisi = event.target.value;

          if (choisi === 'question') {
            onChange({
              field: champ,
              source: 'question',
              question: plates[0]?.rang ?? 0,
              value: null,
            });
            return;
          }

          if (choisi === 'literal') {
            onChange({ field: champ, source: 'literal', question: null, value: '' });
            return;
          }

          onChange(null);
        }}
      >
        <option value="defaut">{t('formulaires.modeDefaut')}</option>
        {/*
          Sans question, « Réponse » ne mènerait qu'à une liste vide : on la
          laisse visible pour dire qu'elle existe, et desactivee pour ne pas
          engager dans une impasse.
        */}
        <option value="question" disabled={plates.length === 0}>
          {t('formulaires.modeReponse')}
        </option>
        <option value="literal">{t('formulaires.valeurFixe')}</option>
      </select>

      {mode === 'question' && (
        <select
          className={cn(CONTROLE, 'min-w-0 flex-1')}
          // Deux listes se suivent sur la ligne : sans nom, la seconde est
          // annoncee « liste » et rien ne dit de quel champ elle regle la
          // valeur.
          aria-label={`${t(`formulaires.champs.${champ}` as 'formulaires.champs.name')} — ${t('formulaires.modeReponse')}`}
          value={mapping?.question ?? 0}
          onChange={(event) => {
            onChange({
              field: champ,
              source: 'question',
              question: Number(event.target.value),
              value: null,
            });
          }}
        >
          {plates.map((plate) => (
            <option key={plate.rang} value={plate.rang}>
              {String(plate.rang)} — {plate.question.label || t('formulaires.libelle')}
            </option>
          ))}
        </select>
      )}

      {mode === 'literal' && (
        <ValeurFixe
          nature={natureDe(champ)}
          valeur={mapping?.value ?? ''}
          etiquette={`${t(`formulaires.champs.${champ}` as 'formulaires.champs.name')} — ${t('formulaires.valeurFixe')}`}
          groupes={groupes}
          comptes={comptes}
          categories={categories}
          onChange={(valeur) => {
            onChange({ field: champ, source: 'literal', question: null, value: valeur });
          }}
        />
      )}
    </div>
  );
}

export function FormsPage() {
  const { t } = useTranslation();
  const peutEcrire = usePeut('form', 'update');
  const queryClient = useQueryClient();

  const [edite, setEdite] = useState<{ id?: number; valeurs: UpsertForm } | null>(null);

  /**
   * Onglet courant de l'éditeur.
   *
   * Trois préoccupations distinctes vivaient sur une seule page : ce qu'est le
   * formulaire, ce qu'il demande, et ce qu'il crée. Empilées, elles imposent un
   * défilement de plusieurs écrans où l'on perd de vue ce qu'on est en train de
   * régler. Elles se traitent l'une après l'autre, jamais ensemble.
   */
  const [onglet, setOnglet] = useState<'formulaire' | 'questions' | 'destination'>('formulaire');
  const [erreur, setErreur] = useState<string | null>(null);

  const formulaires = useQuery({ queryKey: ['forms'], queryFn: api.forms, retry: false });

  // Groupes et comptes servent aux correspondances qui designent un acteur.
  // `retry: false` : sans le droit de les lire, la liste reste vide et la
  // saisie retombe sur l'identifiant -- ce n'est pas une panne.
  const groupes = useQuery({ queryKey: ['groups'], queryFn: api.groups, retry: false });
  const categories = useQuery({
    queryKey: ['itil-categories', 'ticket'],
    queryFn: () => api.itilCategories({ type: 'ticket', selectable: true }),
    retry: false,
  });
  const comptes = useQuery({
    queryKey: ['users', 'actifs'],
    queryFn: () => api.users({ inactive: false }),
    retry: false,
  });

  const enregistrer = useMutation({
    mutationFn: ({ id, valeurs }: { id?: number; valeurs: UpsertForm }) =>
      api.saveForm(valeurs, id),
    onSuccess: async () => {
      setEdite(null);
      setErreur(null);
      await queryClient.invalidateQueries({ queryKey: ['forms'] });
    },
    onError: (error: unknown) => {
      setErreur(error instanceof Error ? error.message : String(error));
    },
  });

  const supprimer = useMutation({
    mutationFn: api.deleteForm,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['forms'] }),
  });

  if (formulaires.error instanceof ApiError && formulaires.error.status === 403) {
    return (
      <p className="rounded-md border border-caution/30 bg-caution-soft p-3 text-sm text-caution-ink">
        {t('entites.interdit')}
      </p>
    );
  }

  const maj = (patch: Partial<UpsertForm>): void => {
    if (!edite) return;

    setEdite({ ...edite, valeurs: { ...edite.valeurs, ...patch } });
  };

  const majQuestion = (
    indexSection: number,
    indexQuestion: number,
    patch: Partial<FormQuestion>,
  ): void => {
    if (!edite) return;

    maj({
      sections: edite.valeurs.sections.map((section, position) =>
        position !== indexSection
          ? section
          : {
              ...section,
              questions: section.questions.map((question, rang) =>
                rang === indexQuestion ? { ...question, ...patch } : question,
              ),
            },
      ),
    });
  };

  const plates = edite ? aplatir(edite.valeurs) : [];
  const destination = edite?.valeurs.destinations[0];

  /**
   * Correspondance en vigueur pour un champ.
   *
   * La **dernière** l'emporte, et non la première : c'est ce que fait le
   * serveur, qui affecte `sortie[mapping.field]` en parcourant la liste. Un
   * formulaire enregistre avant cet ecran a pu recevoir deux correspondances
   * sur un meme champ ; montrer la premiere ferait mentir l'apercu.
   */
  const mappingDe = (champ: string): FormMapping | undefined =>
    destination?.mappings.filter((mapping) => mapping.field === champ).at(-1);

  const majMapping = (champ: string, mapping: FormMapping | null): void => {
    if (!edite || !destination) return;

    // Les doublons eventuels partent avec : l'ecran ne peut plus en produire,
    // et en laisser trainer un rendrait l'enregistrement suivant illisible.
    const autres = destination.mappings.filter((entree) => entree.field !== champ);

    maj({
      destinations: [{ ...destination, mappings: mapping ? [...autres, mapping] : autres }],
    });
  };

  return (
    <section className="space-y-5">
      <PageHeader
        title={t('formulaires.titre')}
        description={t('formulaires.intro')}
        action={
          peutEcrire && (
            <button
              type="button"
              className={BOUTON_PRIMAIRE}
              onClick={() => {
                setEdite({ valeurs: formulaireVide() });
                setOnglet('formulaire');
              }}
            >
              {t('formulaires.nouveau')}
            </button>
          )
        }
      />

      {erreur && <p className="text-sm text-critical">{erreur}</p>}

      {formulaires.data?.length === 0 && (
        <p className="text-sm text-muted">{t('formulaires.aucun')}</p>
      )}

      <div className={cn('divide-y divide-line border-y border-line', edite && 'hidden')}>
        {formulaires.data?.map((forme) => (
          <div key={forme.id} className="px-1 py-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">{forme.name}</p>
                <p className="text-xs text-muted">
                  {forme.category ?? '—'} · {forme.entityName}
                  {forme.isRecursive ? ' ↓' : ''} ·{' '}
                  {String(forme.sections.reduce((total, s) => total + s.questions.length, 0))}{' '}
                  {t('formulaires.questions').toLowerCase()}
                  {!forme.isActive ? ` · ${t('notifications.etats.cancelled')}` : ''}
                </p>
              </div>

              <div className="flex gap-1">
                <button
                  type="button"
                  className={ACTION_LIGNE}
                  onClick={() => {
                    setEdite({ id: forme.id, valeurs: versFormulaire(forme) });
                  }}
                >
                  {t('commun.modifier')}
                </button>
                <button
                  type="button"
                  className={ACTION_LIGNE}
                  onClick={() => {
                    supprimer.mutate(forme.id);
                  }}
                >
                  {t('calendriers.supprimer')}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {edite && (
        <form
          className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]"
          onSubmit={(event) => {
            event.preventDefault();
            enregistrer.mutate(edite);
          }}
        >
          <div className="min-w-0 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink pb-3">
              <h3 className="text-lg font-bold tracking-tight text-ink">
                {edite.id === undefined
                  ? t('formulaires.nouveau')
                  : edite.valeurs.name || t('formulaires.nom')}
              </h3>

              <Tabs
                value={onglet}
                onChange={setOnglet}
                options={[
                  { value: 'formulaire', label: t('formulaires.ongletFormulaire') },
                  {
                    value: 'questions',
                    // Le compte evite d'ouvrir l'onglet pour savoir s'il est vide.
                    label: `${t('formulaires.ongletQuestions')} · ${String(plates.length)}`,
                  },
                  { value: 'destination', label: t('formulaires.ongletDestination') },
                ]}
              />
            </div>

            {onglet === 'formulaire' && (
              <div className="grid gap-3 md:grid-cols-4">
                <label className="space-y-1 md:col-span-2">
                  <span className="block text-[11px] font-semibold tracking-wider text-faint uppercase">
                    {t('formulaires.nom')}
                  </span>
                  <input
                    className={CONTROLE}
                    required
                    value={edite.valeurs.name}
                    onChange={(event) => {
                      maj({ name: event.target.value });
                    }}
                  />
                </label>

                <label className="space-y-1">
                  <span className="block text-[11px] font-semibold tracking-wider text-faint uppercase">
                    {t('formulaires.rubrique')}
                  </span>
                  <input
                    className={CONTROLE}
                    value={edite.valeurs.category ?? ''}
                    onChange={(event) => {
                      maj({ category: event.target.value || null });
                    }}
                  />
                </label>

                <label className="space-y-1">
                  <span className="block text-[11px] font-semibold tracking-wider text-faint uppercase">
                    {t('formulaires.rang')}
                  </span>
                  <input
                    type="number"
                    className={CONTROLE}
                    value={edite.valeurs.ranking}
                    onChange={(event) => {
                      maj({ ranking: Number(event.target.value) });
                    }}
                  />
                </label>

                <label className="space-y-1 md:col-span-3">
                  <span className="block text-[11px] font-semibold tracking-wider text-faint uppercase">
                    {t('formulaires.description')}
                  </span>
                  <input
                    className={CONTROLE}
                    value={edite.valeurs.description ?? ''}
                    onChange={(event) => {
                      maj({ description: event.target.value || null });
                    }}
                  />
                </label>

                <div className="flex flex-col justify-end gap-1 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={edite.valeurs.isActive}
                      onChange={(event) => {
                        maj({ isActive: event.target.checked });
                      }}
                    />
                    <span>{t('notifications.actif')}</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={edite.valeurs.isRecursive}
                      onChange={(event) => {
                        maj({ isRecursive: event.target.checked });
                      }}
                    />
                    <span>{t('commun.recursif')}</span>
                  </label>
                </div>
              </div>
            )}

            {/* ---- Sections et questions ---- */}
            {onglet === 'questions' && (
              <>
                {edite.valeurs.sections.map((section, indexSection) => (
                  /* La section n'est plus une boite : un numero, un titre et un filet.
                   Des boites dans des boites de meme poids -- section, question,
                   condition -- empechent de voir ou une question se termine. */
                  <div key={indexSection} className="space-y-3">
                    <div className="flex items-center gap-2 border-b border-line pb-2">
                      <span className="grid size-5 shrink-0 place-items-center rounded-[2px] bg-ink text-[10px] font-bold text-canvas tabular-nums">
                        {String(indexSection + 1)}
                      </span>
                      <input
                        className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-semibold text-ink placeholder:text-faint focus:outline-none"
                        required
                        placeholder={t('formulaires.section')}
                        value={section.name}
                        onChange={(event) => {
                          maj({
                            sections: edite.valeurs.sections.map((autre, position) =>
                              position === indexSection
                                ? { ...autre, name: event.target.value }
                                : autre,
                            ),
                          });
                        }}
                      />
                      <button
                        type="button"
                        className={ACTION_LIGNE_DANGER}
                        onClick={() => {
                          maj({
                            sections: edite.valeurs.sections.filter(
                              (_, position) => position !== indexSection,
                            ),
                          });
                        }}
                      >
                        {t('recherche.retirer')}
                      </button>
                    </div>

                    {section.questions.map((question, indexQuestion) => {
                      const rang =
                        plates.find((plate) => plate.question === question && plate.rang >= 0)
                          ?.rang ?? 0;

                      return (
                        <div
                          key={indexQuestion}
                          className="space-y-2 border-l-2 border-line py-2 pl-3"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            {/* Le rang est technique : il sert aux conditions et aux
                              correspondances, qui designent les questions par lui.
                              Il reste donc visible, mais discret. */}
                            <span className="w-5 font-mono text-[10px] text-faint tabular-nums">
                              {String(rang)}
                            </span>

                            <input
                              className={cn(CONTROLE, 'min-w-0 flex-1')}
                              required
                              placeholder={t('formulaires.libelle')}
                              value={question.label}
                              onChange={(event) => {
                                majQuestion(indexSection, indexQuestion, {
                                  label: event.target.value,
                                });
                              }}
                            />

                            <select
                              className={cn(CONTROLE, 'w-40')}
                              value={question.kind}
                              onChange={(event) => {
                                majQuestion(indexSection, indexQuestion, {
                                  kind: event.target.value as FormQuestionKind,
                                });
                              }}
                            >
                              {FAMILLES.map((famille) => (
                                <optgroup
                                  key={famille.cle}
                                  label={t(`formulaires.familles.${famille.cle}`)}
                                >
                                  {famille.natures.map((nature) => (
                                    <option key={nature} value={nature}>
                                      {t(`formulaires.natures.${nature}`)}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>

                            <label className="flex items-center gap-1 text-xs">
                              <input
                                type="checkbox"
                                checked={question.isRequired}
                                onChange={(event) => {
                                  majQuestion(indexSection, indexQuestion, {
                                    isRequired: event.target.checked,
                                  });
                                }}
                              />
                              {t('formulaires.obligatoire')}
                            </label>

                            <button
                              type="button"
                              className={ACTION_LIGNE_DANGER}
                              onClick={() => {
                                maj({
                                  sections: edite.valeurs.sections.map((autre, position) =>
                                    position !== indexSection
                                      ? autre
                                      : {
                                          ...autre,
                                          questions: autre.questions.filter(
                                            (_, rangQuestion) => rangQuestion !== indexQuestion,
                                          ),
                                        },
                                  ),
                                });
                              }}
                            >
                              {t('recherche.retirer')}
                            </button>
                          </div>

                          {KINDS_A_OPTIONS.includes(question.kind) && (
                            <label className="block space-y-1">
                              <span className="block text-[11px] font-semibold tracking-wider text-faint uppercase">
                                {t('formulaires.choix')}
                              </span>
                              <textarea
                                className={cn(CONTROLE, 'h-20')}
                                placeholder={t('formulaires.choix')}
                                value={question.options.join('\n')}
                                onChange={(event) => {
                                  majQuestion(indexSection, indexQuestion, {
                                    options: event.target.value.split('\n').filter(Boolean),
                                  });
                                }}
                              />
                            </label>
                          )}

                          {question.conditions.map((condition, indexCondition) => (
                            <div key={indexCondition} className="flex flex-wrap items-center gap-2">
                              <span className="block text-[11px] font-semibold tracking-wider text-faint uppercase">
                                {t('formulaires.conditions')}
                              </span>

                              <select
                                className={cn(CONTROLE, 'w-56')}
                                value={condition.dependsOn}
                                onChange={(event) => {
                                  majQuestion(indexSection, indexQuestion, {
                                    conditions: question.conditions.map((autre, position) =>
                                      position === indexCondition
                                        ? { ...autre, dependsOn: Number(event.target.value) }
                                        : autre,
                                    ),
                                  });
                                }}
                              >
                                {plates
                                  .filter((plate) => plate.rang < rang)
                                  .map((plate) => (
                                    <option key={plate.rang} value={plate.rang}>
                                      {String(plate.rang)} — {plate.question.label}
                                    </option>
                                  ))}
                              </select>

                              <select
                                className={cn(CONTROLE, 'w-40')}
                                value={condition.operator}
                                onChange={(event) => {
                                  majQuestion(indexSection, indexQuestion, {
                                    conditions: question.conditions.map((autre, position) =>
                                      position === indexCondition
                                        ? { ...autre, operator: event.target.value as RuleOperator }
                                        : autre,
                                    ),
                                  });
                                }}
                              >
                                {OPERATEURS.map((operateur) => (
                                  <option key={operateur} value={operateur}>
                                    {t(`regles.operateurs.${operateur}`)}
                                  </option>
                                ))}
                              </select>

                              <input
                                className={cn(CONTROLE, 'w-40')}
                                value={condition.value ?? ''}
                                onChange={(event) => {
                                  majQuestion(indexSection, indexQuestion, {
                                    conditions: question.conditions.map((autre, position) =>
                                      position === indexCondition
                                        ? { ...autre, value: event.target.value }
                                        : autre,
                                    ),
                                  });
                                }}
                              />

                              <button
                                type="button"
                                className={BOUTON}
                                onClick={() => {
                                  majQuestion(indexSection, indexQuestion, {
                                    conditions: question.conditions.filter(
                                      (_, position) => position !== indexCondition,
                                    ),
                                  });
                                }}
                              >
                                {t('recherche.retirer')}
                              </button>
                            </div>
                          ))}

                          {rang > 0 && (
                            <button
                              type="button"
                              className={BOUTON}
                              onClick={() => {
                                majQuestion(indexSection, indexQuestion, {
                                  conditions: [
                                    ...question.conditions,
                                    { dependsOn: 0, operator: 'is', value: '' },
                                  ],
                                });
                              }}
                            >
                              {t('formulaires.ajouterCondition')}
                            </button>
                          )}
                        </div>
                      );
                    })}

                    <button
                      type="button"
                      className={BOUTON}
                      onClick={() => {
                        maj({
                          sections: edite.valeurs.sections.map((autre, position) =>
                            position !== indexSection
                              ? autre
                              : {
                                  ...autre,
                                  questions: [
                                    ...autre.questions,
                                    {
                                      kind: 'text' as const,
                                      label: '',
                                      description: null,
                                      isRequired: false,
                                      options: [],
                                      defaultValue: null,
                                      conditions: [],
                                    },
                                  ],
                                },
                          ),
                        });
                      }}
                    >
                      {t('formulaires.ajouterQuestion')}
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  className={BOUTON}
                  onClick={() => {
                    maj({
                      sections: [
                        ...edite.valeurs.sections,
                        { name: '', description: null, questions: [] },
                      ],
                    });
                  }}
                >
                  {t('formulaires.ajouterSection')}
                </button>
              </>
            )}

            {onglet === 'destination' && destination && (
              <div className="space-y-5">
                <div className="space-y-1 border-l-2 border-ink pl-3">
                  <p className="text-sm font-semibold text-ink">
                    {t('formulaires.destinationTicket')}
                  </p>
                  <p className="text-xs text-muted">{t('formulaires.destinationAide')}</p>
                  {plates.length === 0 && (
                    <p className="text-xs text-brand-ink">{t('formulaires.sansQuestion')}</p>
                  )}
                </div>

                {FAMILLES_CHAMPS.map((famille) => (
                  <div key={famille.cle} className="space-y-2">
                    <SectionTitle>
                      {t(
                        `formulaires.famillesChamps.${famille.cle}` as
                          'formulaires.famillesChamps.contenu',
                      )}
                    </SectionTitle>

                    {famille.champs.map((champ) => (
                      <LigneDestination
                        key={champ}
                        champ={champ}
                        mapping={mappingDe(champ)}
                        plates={plates}
                        groupes={groupes.data ?? []}
                        comptes={comptes.data ?? []}
                        categories={categories.data ?? []}
                        onChange={(mapping) => {
                          majMapping(champ, mapping);
                        }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/*
              Le pied d'action reste sous les yeux.
              L'onglet « Questions » est long par nature : laisser « Enregistrer »
              tout en bas obligerait a redescendre tout le formulaire apres chaque
              retouche, et c'est ainsi qu'on perd une saisie en changeant d'ecran.
            */}
            <div className="sticky bottom-0 -mx-1 flex gap-2 border-t border-line bg-canvas px-1 py-3">
              <button type="submit" className={BOUTON_PRIMAIRE}>
                {t('commun.enregistrer')}
              </button>
              <button
                type="button"
                className={BOUTON}
                onClick={() => {
                  setEdite(null);
                }}
              >
                {t('commun.annuler')}
              </button>
            </div>
          </div>

          {/*
            L'apercu accompagne la construction, colle en haut de colonne.
            Composer a l'aveugle est le defaut central d'un constructeur : on
            empile des champs sans voir la page qu'ils font, et l'on decouvre a
            la premiere soumission qu'une section est vide ou qu'une question
            est incomprehensible.
          */}
          <aside className="space-y-3 xl:sticky xl:top-20 xl:self-start">
            <SectionTitle>{t('formulaires.apercu')}</SectionTitle>
            <p className="text-xs text-faint">{t('formulaires.apercuAide')}</p>

            <div className="border border-line bg-surface p-4">
              <FormPreview
                valeurs={edite.valeurs}
                referentiels={{
                  utilisateurs: comptes.data ?? [],
                  groupes: groupes.data ?? [],
                  categories: categories.data ?? [],
                }}
              />
            </div>
          </aside>
        </form>
      )}
    </section>
  );
}
