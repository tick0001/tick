import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  Form,
  FormMapping,
  FormQuestion,
  FormSubmissionResult,
  FormSummary,
  FormTranslation,
  SubmitForm,
  TicketActorInput,
  UpsertForm,
} from '@tick/contracts';
import { KINDS_SANS_REPONSE } from '@tick/contracts';
import {
  formAccess,
  formDestinations,
  formQuestionConditions,
  formQuestions,
  formSections,
  formSubmissions,
  formTranslations,
  forms,
  sql,
  type SQL,
  type Transaction,
} from '@tick/db';
import { entityNames } from '../common/entity-names.js';
import { requireContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { matchesOperator } from '../rules/rule-engine.service.js';
import { applyRuleOutput, borne, choix, reference, texte } from '../tickets/ticket-rules.js';
import { TicketsService } from '../tickets/tickets.service.js';

interface FormRow extends Record<string, unknown> {
  id: number;
  name: string;
  description: string | null;
  category: string | null;
  isActive: boolean;
  ranking: number;
  entityId: number;
  isRecursive: boolean;
  sections: unknown;
  access: unknown;
  destinations: unknown;
}

const TYPES = ['incident', 'request'] as const;

/**
 * Formulaires du catalogue de services.
 *
 * Un formulaire est une **configuration** ; ce qu'il produit est une donnée. La
 * soumission passe donc par `TicketsService`, et non par une écriture directe :
 * un ticket né d'un formulaire doit recevoir ses règles, ses engagements et son
 * historique comme n'importe quel autre.
 */
@Injectable()
export class FormsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tickets: TicketsService,
  ) {}

  async list(): Promise<Form[]> {
    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<FormRow>(sql`
        ${this.selection()} WHERE f.deleted_at IS NULL ORDER BY f.ranking, f.name
      `);

      return resultat.rows;
    });

    return this.nommer(rows);
  }

  async findById(id: number): Promise<Form> {
    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<FormRow>(sql`
        ${this.selection()} WHERE f.id = ${id} AND f.deleted_at IS NULL
      `);

      return resultat.rows;
    });

    const [formulaire] = await this.nommer(rows);

    if (!formulaire) throw new NotFoundException('Formulaire introuvable dans ce perimetre.');

    return formulaire;
  }

  /**
   * Catalogue visible de la personne connectée.
   *
   * Un formulaire sans politique d'accès est ouvert à tout le périmètre ; sinon
   * il faut correspondre à une cible. Le filtre est ici et non dans une
   * politique SQL parce qu'il dépend des groupes, que la session ne porte pas.
   */
  async catalogue(): Promise<FormSummary[]> {
    const locale = requireContext().locale;

    return this.db.asUser(async (tx) => {
      // La traduction s'applique **ici aussi**, et pas seulement au rendu du
      // formulaire. C'est la liste du catalogue que le demandeur parcourt pour
      // choisir : servir le nom d'origine ici et le nom traduit apres le clic
      // fait changer le titre de langue sous ses yeux, et laisse un lecteur
      // anglophone chercher dans une liste en francais.
      //
      // `COALESCE` et non un `CASE` : sans traduction dans cette langue, la
      // saisie d'origine reste. Les libelles sont ecrits par un administrateur,
      // pas traduits par le produit, et un vide serait pire que l'autre langue.
      //
      // Le tri garde `f.name` : ordonner sur le libelle traduit ferait changer
      // l'ordre du catalogue d'une langue a l'autre, pour un gain nul.
      const resultat = await tx.execute<FormSummary & Record<string, unknown>>(sql`
        SELECT f.id,
               COALESCE(t.label, f.name) AS name,
               COALESCE(t.description, f.description) AS description,
               f.category
          FROM forms f
          LEFT JOIN form_translations t
                 ON t.item_type = 'form' AND t.item_id = f.id AND t.locale = ${locale}
         WHERE f.deleted_at IS NULL AND f.is_active AND ${this.accessCondition()}
         ORDER BY f.category NULLS FIRST, f.ranking, f.name
      `);

      return resultat.rows;
    });
  }

  /**
   * Applique les traductions a la langue du lecteur.
   *
   * Sans traduction dans cette langue, la saisie d'origine reste : les libelles
   * de formulaires sont ecrits par un administrateur, pas traduits par le
   * produit, et afficher un vide serait pire que d'afficher l'autre langue.
   */
  private static traduire(formulaire: Form, locale: string): Form {
    const choisir = <T extends { translations: readonly FormTranslation[] }>(
      objet: T,
    ): FormTranslation | undefined => objet.translations.find((t) => t.locale === locale);

    const traduction = choisir(formulaire);

    return {
      ...formulaire,
      name: traduction?.label ?? formulaire.name,
      description: traduction?.description ?? formulaire.description,
      sections: formulaire.sections.map((section) => {
        const pourSection = choisir(section);

        return {
          ...section,
          name: pourSection?.label ?? section.name,
          description: pourSection?.description ?? section.description,
          questions: section.questions.map((question) => {
            const pourQuestion = choisir(question);

            return {
              ...question,
              label: pourQuestion?.label ?? question.label,
              description: pourQuestion?.description ?? question.description,
            };
          }),
        };
      }),
    };
  }

  /** Formulaire à remplir, refusé si la politique d'accès l'exclut. */
  async render(id: number): Promise<Form> {
    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<FormRow>(sql`
        ${this.selection()}
         WHERE f.id = ${id} AND f.deleted_at IS NULL AND f.is_active
           AND ${this.accessCondition()}
      `);

      return resultat.rows;
    });

    const [formulaire] = await this.nommer(rows);

    if (!formulaire) throw new NotFoundException('Formulaire introuvable ou non accessible.');

    return FormsService.traduire(formulaire, requireContext().locale);
  }

  async save(input: UpsertForm, id?: number): Promise<Form> {
    const context = requireContext();

    const formId = await this.db.asUser(async (tx) => {
      let cible = id;

      if (cible) {
        const resultat = await tx.execute(sql`
          UPDATE forms
             SET name = ${input.name}, description = ${input.description ?? null},
                 category = ${input.category ?? null}, is_active = ${input.isActive},
                 ranking = ${input.ranking}, is_recursive = ${input.isRecursive},
                 updated_at = now()
           WHERE id = ${cible} AND deleted_at IS NULL
        `);

        if (resultat.rowCount === 0) {
          throw new NotFoundException('Formulaire introuvable dans ce perimetre.');
        }
      } else {
        const [ligne] = await tx
          .insert(forms)
          .values({
            entityId: context.entityId,
            entityPath: 'temporaire',
            isRecursive: input.isRecursive,
            name: input.name,
            description: input.description ?? null,
            category: input.category ?? null,
            isActive: input.isActive,
            ranking: input.ranking,
          })
          .returning({ id: forms.id });

        if (!ligne) throw new BadRequestException('Creation impossible dans ce perimetre.');
        cible = ligne.id;
      }

      // Sections et questions sont remplacees en bloc : la cascade emporte
      // conditions et traductions, qui n'ont pas de sens sans leur question.
      // `form_translations` est polymorphe, donc sans cle etrangere : rien ne
      // supprime ses lignes en cascade. Sans ce nettoyage, chaque enregistrement
      // laisserait derriere lui les traductions des sections et des questions
      // qu'il vient de remplacer, rattachees a des identifiants disparus.
      await this.oublierTraductions(tx, cible);
      await tx.execute(sql`DELETE FROM form_sections WHERE form_id = ${cible}`);
      await tx.execute(sql`DELETE FROM form_access WHERE form_id = ${cible}`);
      await tx.execute(sql`DELETE FROM form_destinations WHERE form_id = ${cible}`);

      await this.ecrireTraductions(tx, 'form', cible, input.translations);

      // Les questions sont numerotees a plat, dans l'ordre du formulaire : c'est
      // ce rang que les conditions et les correspondances designent, et non un
      // identifiant de base que l'interface n'a pas a connaitre.
      const parRang = new Map<number, number>();
      let rang = 0;

      for (const [indexSection, section] of input.sections.entries()) {
        const [ligneSection] = await tx
          .insert(formSections)
          .values({
            formId: cible,
            name: section.name,
            description: section.description ?? null,
            ranking: indexSection,
          })
          .returning({ id: formSections.id });

        if (!ligneSection) continue;

        await this.ecrireTraductions(tx, 'section', ligneSection.id, section.translations);

        for (const [indexQuestion, question] of section.questions.entries()) {
          const [ligneQuestion] = await tx
            .insert(formQuestions)
            .values({
              sectionId: ligneSection.id,
              kind: question.kind,
              label: question.label,
              description: question.description ?? null,
              isRequired: question.isRequired,
              ranking: indexQuestion,
              options: question.options,
              defaultValue: question.defaultValue ?? null,
            })
            .returning({ id: formQuestions.id });

          if (ligneQuestion) {
            parRang.set(rang, ligneQuestion.id);
            await this.ecrireTraductions(tx, 'question', ligneQuestion.id, question.translations);
          }

          rang += 1;
        }
      }

      rang = 0;

      for (const section of input.sections) {
        for (const question of section.questions) {
          const questionId = parRang.get(rang);

          rang += 1;

          if (!questionId || question.conditions.length === 0) continue;

          for (const condition of question.conditions) {
            const dependId = parRang.get(condition.dependsOn);

            if (!dependId) {
              throw new BadRequestException(
                `Condition invalide : la question ${String(condition.dependsOn)} n'existe pas.`,
              );
            }

            await tx.insert(formQuestionConditions).values({
              questionId,
              dependsOnId: dependId,
              operator: condition.operator,
              value: condition.value ?? null,
            });
          }
        }
      }

      if (input.access.length > 0) {
        await tx.insert(formAccess).values(
          input.access.map((entree) => ({
            formId: cible,
            targetType: entree.targetType,
            targetId: entree.targetId,
          })),
        );
      }

      if (input.destinations.length > 0) {
        await tx.insert(formDestinations).values(
          input.destinations.map((destination) => ({
            formId: cible,
            kind: destination.kind,
            mappings: destination.mappings,
          })),
        );
      }

      return cible;
    });

    return this.findById(formId);
  }

  async remove(id: number): Promise<void> {
    await this.db.asUser(async (tx) => {
      const resultat = await tx.execute(
        sql`UPDATE forms SET deleted_at = now() WHERE id = ${id} AND deleted_at IS NULL`,
      );

      if (resultat.rowCount === 0) {
        throw new NotFoundException('Formulaire introuvable dans ce perimetre.');
      }
    });
  }

  /**
   * Enregistre une soumission et crée l'objet demandé.
   *
   * Les réponses complètes sont conservées, même celles qu'aucune
   * correspondance ne reprend : une question retirée du formulaire emporterait
   * sinon avec elle ce que les demandeurs y avaient répondu.
   */
  async submit(id: number, input: SubmitForm): Promise<FormSubmissionResult> {
    const context = requireContext();
    const formulaire = await this.render(id);
    const questions = aplatir(formulaire);
    const reponses = input.answers;

    for (const [rang, question] of questions.entries()) {
      if (!estVisible(question, rang, questions, reponses)) continue;

      // Un bloc d'explication n'attend aucune reponse. Le marquer obligatoire
      // est une erreur de saisie de l'auteur, pas une exigence a faire respecter
      // au demandeur -- qui n'aurait aucun moyen d'y satisfaire.
      if (KINDS_SANS_REPONSE.includes(question.kind)) continue;
      if (!question.isRequired) continue;

      const valeur = reponses[String(rang)];

      if (
        valeur === null ||
        valeur === undefined ||
        valeur === '' ||
        (Array.isArray(valeur) && valeur.length === 0)
      ) {
        throw new BadRequestException(`La question « ${question.label} » est obligatoire.`);
      }
    }

    const destination = formulaire.destinations[0];
    const { champs, acteurs } = destination
      ? this.appliquer(destination.mappings, questions, reponses)
      : { champs: {}, acteurs: [] };

    const ticket = await this.tickets.create({
      // Sans correspondance sur le titre, le nom du formulaire fait l'affaire :
      // « Demande de materiel » vaut mieux qu'un ticket sans objet.
      name: texte(champs, 'name', formulaire.name),
      content: texte(champs, 'content', resume(questions, reponses)),
      type: choix(champs, 'type', TYPES, 'request'),
      urgency: borne(champs['urgency'], 3),
      impact: borne(champs['impact'], 3),
      categoryId: reference(champs, 'categoryId') ?? undefined,
      requestSourceId: reference(champs, 'requestSourceId') ?? undefined,
      locationId: reference(champs, 'locationId') ?? undefined,
      actors: [{ role: 'requester', actorType: 'user', actorId: context.userId }, ...acteurs],
    });

    const [soumission] = await this.db.asUser((tx) =>
      tx
        .insert(formSubmissions)
        .values({
          formId: id,
          entityId: context.entityId,
          entityPath: 'temporaire',
          submittedById: context.userId,
          ticketId: ticket.id,
          answers: reponses,
        })
        .returning({ id: formSubmissions.id }),
    );

    return { submissionId: soumission?.id ?? 0, ticketId: ticket.id };
  }

  /**
   * Traduit les correspondances en champs de ticket, et en acteurs.
   *
   * Les deux sortent ensemble parce qu'elles sortent du meme calcul : une
   * correspondance vers « groupe attribue » ne designe pas une colonne du
   * ticket mais un acteur, et les separer ferait perdre l'un des deux.
   */
  private appliquer(
    mappings: readonly FormMapping[],
    questions: readonly FormQuestion[],
    reponses: SubmitForm['answers'],
  ): { champs: Record<string, unknown>; acteurs: TicketActorInput[] } {
    const sortie: Record<string, string | null> = {};

    for (const mapping of mappings) {
      if (mapping.source === 'literal') {
        sortie[mapping.field] = mapping.value ?? null;
        continue;
      }

      const rang = mapping.question;

      if (rang === null || rang === undefined || !questions[rang]) continue;

      sortie[mapping.field] = enTexte(reponses[String(rang)]);
    }

    const champs: Record<string, unknown> = {};

    // Les memes conversions que pour les regles : une correspondance produit du
    // texte, et c'est `applyRuleOutput` qui sait ce qu'un champ de ticket
    // attend. Deux tables de conversion finiraient par diverger.
    return { champs, acteurs: applyRuleOutput(champs, sortie) };
  }

  private selection() {
    return sql`
      SELECT f.id, f.name, f.description, f.category, f.is_active AS "isActive",
             f.ranking, f.entity_id AS "entityId", f.is_recursive AS "isRecursive",
             COALESCE(
               (SELECT jsonb_agg(section ORDER BY section->>'ranking')
                  FROM (
                    SELECT jsonb_build_object(
                             'id', s.id, 'name', s.name, 'description', s.description,
                             'ranking', s.ranking,
                             'questions', COALESCE(
                               (SELECT jsonb_agg(jsonb_build_object(
                                         'id', q.id, 'kind', q.kind::text, 'label', q.label,
                                         'description', q.description,
                                         'isRequired', q.is_required,
                                         'options', COALESCE(q.options, '[]'::jsonb),
                                         'defaultValue', q.default_value,
                                         'conditions', COALESCE(
                                           (SELECT jsonb_agg(jsonb_build_object(
                                                     'dependsOn', d.depends_on_id,
                                                     'operator', d.operator::text,
                                                     'value', d.value))
                                              FROM form_question_conditions d
                                             WHERE d.question_id = q.id),
                                           '[]'::jsonb))
                                       ORDER BY q.ranking, q.id)
                                  FROM form_questions q WHERE q.section_id = s.id),
                               '[]'::jsonb)) AS section
                      FROM form_sections s WHERE s.form_id = f.id
                  ) sections),
               '[]'::jsonb) AS sections,
             COALESCE(
               (SELECT jsonb_agg(jsonb_build_object(
                         'targetType', x.target_type::text, 'targetId', x.target_id))
                  FROM form_access x WHERE x.form_id = f.id),
               '[]'::jsonb) AS access,
             COALESCE(
               (SELECT jsonb_agg(jsonb_build_object('kind', d.kind::text, 'mappings', d.mappings))
                  FROM form_destinations d WHERE d.form_id = f.id),
               '[]'::jsonb) AS destinations
        FROM forms f
    `;
  }

  private accessCondition(): SQL {
    const context = requireContext();

    return sql`
      (
        NOT EXISTS (SELECT 1 FROM form_access x WHERE x.form_id = f.id)
        OR EXISTS (
          SELECT 1 FROM form_access x
           WHERE x.form_id = f.id
             AND (
               (x.target_type = 'profile' AND x.target_id = ${context.profileId})
               OR (x.target_type = 'user' AND x.target_id = ${context.userId})
               OR (x.target_type = 'group' AND EXISTS (
                     SELECT 1 FROM group_members m
                      WHERE m.group_id = x.target_id AND m.user_id = ${context.userId}))
             )
        )
      )
    `;
  }

  /** Le nom de l'entite est resolu a part : voir `entityNames`. */
  /**
   * Ecrit les traductions d'un objet, apres que son identifiant existe.
   *
   * Rien n'est ecrit quand la liste est vide, ce qui est le cas courant : la
   * plupart des formulaires n'existent que dans la langue ou ils ont ete
   * saisis.
   */
  private async ecrireTraductions(
    tx: Transaction,
    itemType: 'form' | 'section' | 'question',
    itemId: number,
    entrees: readonly FormTranslation[] | undefined,
  ): Promise<void> {
    if (!entrees || entrees.length === 0) return;

    await tx.insert(formTranslations).values(
      entrees.map((entree) => ({
        itemType,
        itemId,
        locale: entree.locale,
        label: entree.label,
        description: entree.description,
      })),
    );
  }

  /** Toutes les traductions d'un formulaire, y compris celles de ses enfants. */
  private async oublierTraductions(tx: Transaction, formId: number): Promise<void> {
    await tx.execute(sql`
      DELETE FROM form_translations
       WHERE (item_type = 'form' AND item_id = ${formId})
          OR (item_type = 'section' AND item_id IN (
                SELECT id FROM form_sections WHERE form_id = ${formId}))
          OR (item_type = 'question' AND item_id IN (
                SELECT q.id FROM form_questions q
                  JOIN form_sections s ON s.id = q.section_id
                 WHERE s.form_id = ${formId}))
    `);
  }

  /**
   * Traductions d'un formulaire, indexees par nature et identifiant.
   *
   * Une seule requete pour tout l'arbre : une par objet ferait autant d'allers
   * qu'un formulaire a de questions.
   */
  private async lireTraductions(
    formIds: readonly number[],
  ): Promise<Map<string, FormTranslation[]>> {
    if (formIds.length === 0) return new Map();

    const ids = sql.join(
      formIds.map((valeur) => sql`${valeur}`),
      sql`, `,
    );

    const lignes = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<{
        itemType: string;
        itemId: number;
        locale: string;
        label: string;
        description: string | null;
      }>(sql`
        SELECT t.item_type AS "itemType", t.item_id AS "itemId",
               t.locale, t.label, t.description
          FROM form_translations t
         WHERE (t.item_type = 'form' AND t.item_id IN (${ids}))
            OR (t.item_type = 'section' AND t.item_id IN (
                  SELECT id FROM form_sections WHERE form_id IN (${ids})))
            OR (t.item_type = 'question' AND t.item_id IN (
                  SELECT q.id FROM form_questions q
                    JOIN form_sections s ON s.id = q.section_id
                   WHERE s.form_id IN (${ids})))
      `);

      return resultat.rows;
    });

    const par = new Map<string, FormTranslation[]>();

    for (const ligne of lignes) {
      const cle = `${ligne.itemType}:${String(ligne.itemId)}`;
      const liste = par.get(cle) ?? [];

      liste.push({
        locale: ligne.locale as FormTranslation['locale'],
        label: ligne.label,
        description: ligne.description,
      });
      par.set(cle, liste);
    }

    return par;
  }

  private async nommer(rows: readonly FormRow[]): Promise<Form[]> {
    const noms = await entityNames(
      this.db,
      rows.map((row) => row.entityId),
    );

    const traductions = await this.lireTraductions(rows.map((row) => row.id));
    const pour = (nature: string, id: number | undefined): FormTranslation[] =>
      id === undefined ? [] : (traductions.get(`${nature}:${String(id)}`) ?? []);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category,
      isActive: row.isActive,
      ranking: row.ranking,
      entityId: row.entityId,
      entityName: noms.get(row.entityId) ?? '',
      isRecursive: row.isRecursive,
      // Les traductions sont exposees telles quelles, jamais substituees ici :
      // `nommer` sert l'editeur, qui doit voir la saisie d'origine. Substituer
      // ici lui ferait reenregistrer la traduction a la place de l'original.
      translations: pour('form', row.id),
      sections: enRangs(
        (Array.isArray(row.sections) ? (row.sections as Form['sections']) : []).map((section) => ({
          ...section,
          translations: pour('section', section.id),
          questions: section.questions.map((question) => ({
            ...question,
            translations: pour('question', question.id),
          })),
        })),
      ),
      access: Array.isArray(row.access) ? (row.access as Form['access']) : [],
      destinations: Array.isArray(row.destinations)
        ? (row.destinations as Form['destinations'])
        : [],
    }));
  }
}

/**
 * Remplace l'identifiant de la question dont depend une condition par son rang.
 *
 * La base designe une question par sa cle ; le contrat, par sa position dans le
 * formulaire. C'est la position que l'interface manipule — elle compose un
 * formulaire avant que ses questions existent en base — et la traduction se
 * fait donc ici, une fois pour toutes.
 */
function enRangs(sections: Form['sections']): Form['sections'] {
  const rangParId = new Map<number, number>();
  let rang = 0;

  for (const section of sections) {
    for (const question of section.questions) {
      if (question.id !== undefined) rangParId.set(question.id, rang);
      rang += 1;
    }
  }

  return sections.map((section) => ({
    ...section,
    questions: section.questions.map((question) => ({
      ...question,
      conditions: question.conditions
        .map((condition) => ({
          ...condition,
          dependsOn: rangParId.get(condition.dependsOn) ?? -1,
        }))
        // Une condition dont la question a disparu ne peut plus etre evaluee :
        // la garder ferait disparaitre la question qui en depend, sans raison
        // visible a l'ecran.
        .filter((condition) => condition.dependsOn >= 0),
    })),
  }));
}

/** Questions du formulaire, à plat, dans l'ordre d'affichage. */
export function aplatir(formulaire: Form): FormQuestion[] {
  return formulaire.sections.flatMap((section) => section.questions);
}

/**
 * Une question s'affiche si **toutes** ses conditions sont vraies.
 *
 * Une condition qui dépend d'une question elle-même masquée est fausse : sans
 * cela, une branche entière ressurgirait dès que sa racine disparaît.
 */
export function estVisible(
  question: FormQuestion,
  rang: number,
  questions: readonly FormQuestion[],
  reponses: SubmitForm['answers'],
): boolean {
  if (question.conditions.length === 0) return true;

  return question.conditions.every((condition) => {
    const source = questions[condition.dependsOn];

    if (!source) return false;
    if (condition.dependsOn >= rang) return false;
    if (!estVisible(source, condition.dependsOn, questions, reponses)) return false;
    if (condition.operator === 'regex' || condition.operator === 'not_regex') return false;

    return matchesOperator(
      condition.operator,
      enTexte(reponses[String(condition.dependsOn)]),
      condition.value,
    );
  });
}

/** Réponse sous forme de texte, une réponse multiple étant jointe. */
function enTexte(valeur: string | string[] | null | undefined): string | null {
  if (valeur === null || valeur === undefined) return null;

  return Array.isArray(valeur) ? valeur.join(', ') : valeur;
}

/**
 * Description reprenant les questions et leurs réponses.
 *
 * Sans elle, un formulaire sans correspondance sur la description produirait un
 * ticket vide : le technicien verrait un titre et rien d'autre, alors que le
 * demandeur a rempli dix champs.
 */
function resume(questions: readonly FormQuestion[], reponses: SubmitForm['answers']): string {
  return questions
    .map((question, rang) => {
      const valeur = enTexte(reponses[String(rang)]);

      return valeur === null || valeur === '' ? null : `${question.label} : ${valeur}`;
    })
    .filter((ligne): ligne is string => ligne !== null)
    .join('\n');
}
