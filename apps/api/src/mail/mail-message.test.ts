import { describe, expect, it } from 'vitest';
import {
  bareAddress,
  citedMessageIds,
  isAutoReply,
  isFromSelf,
  stripQuotedReply,
  ticketFromSubject,
  withSubjectToken,
  type IncomingMail,
} from './mail-message.js';

function message(partial: Partial<IncomingMail> = {}): IncomingMail {
  return {
    messageId: '<abc@exemple.fr>',
    from: 'Paul Durand <paul@exemple.fr>',
    subject: 'Un souci',
    text: '',
    html: null,
    inReplyTo: null,
    references: [],
    headers: {},
    attachments: [],
    ...partial,
  };
}

describe('rattachement par le sujet', () => {
  it('reconnaît le marqueur, où qu’il soit', () => {
    expect(ticketFromSubject('[#42] Imprimante en panne')).toBe(42);
    expect(ticketFromSubject('Re: [#42] Imprimante en panne')).toBe(42);
    expect(ticketFromSubject('TR: Re: [#1234] Suite')).toBe(1234);
  });

  it('ignore un numéro nu, qui n’est pas un rattachement', () => {
    // Le piège : un utilisateur écrit « erreur #500 » dans son objet, et le
    // greffer sur le ticket 500 mêlerait deux demandes sans rapport.
    expect(ticketFromSubject('Erreur #500 sur le portail')).toBeNull();
    expect(ticketFromSubject('Facture #42 en retard')).toBeNull();
  });

  it('ajoute le marqueur une seule fois', () => {
    expect(withSubjectToken('Imprimante', 7)).toBe('[#7] Imprimante');
    expect(withSubjectToken('[#7] Imprimante', 7)).toBe('[#7] Imprimante');
  });
});

describe('réponses automatiques', () => {
  it('reconnaît Auto-Submitted', () => {
    expect(isAutoReply(message({ headers: { 'auto-submitted': 'auto-replied' } }))).toBe(true);
    // `no` est la valeur d'un message écrit par une personne.
    expect(isAutoReply(message({ headers: { 'auto-submitted': 'no' } }))).toBe(false);
  });

  it('reconnaît une liste de diffusion et un envoi en masse', () => {
    expect(isAutoReply(message({ headers: { precedence: 'bulk' } }))).toBe(true);
    expect(isAutoReply(message({ headers: { 'list-id': '<annonces.exemple.fr>' } }))).toBe(true);
  });

  it('laisse passer un message ordinaire', () => {
    expect(isAutoReply(message({ headers: { 'content-type': 'text/plain' } }))).toBe(false);
  });

  it('reconnaît nos propres adresses, pour couper la boucle', () => {
    // Le nom affiché ne doit pas masquer l'adresse : une messagerie écrit
    // « Tick& <support@exemple.fr> », et c'est précisément ce message-là qu'il
    // faut refuser de traiter.
    expect(
      isFromSelf(message({ from: 'Tick& <support@exemple.fr>' }), ['support@exemple.fr']),
    ).toBe(true);
    expect(isFromSelf(message({ from: 'support@exemple.fr' }), ['SUPPORT@exemple.fr'])).toBe(true);
    expect(isFromSelf(message({ from: 'paul@exemple.fr' }), ['support@exemple.fr'])).toBe(false);
  });
});

describe('extraction de la réponse', () => {
  it('coupe à la citation anglaise', () => {
    const texte = [
      'Le problème persiste ce matin.',
      '',
      'On Mon, 7 Sep 2026 at 09:12, Tick& <support@exemple.fr> wrote:',
      '> Bonjour, votre ticket a été ouvert.',
    ].join('\n');

    expect(stripQuotedReply(texte)).toBe('Le problème persiste ce matin.');
  });

  it('coupe à la citation française', () => {
    const texte = [
      'Merci, c’est réglé.',
      '',
      'Le 7 septembre 2026 à 09:12, Tick& a écrit :',
      '> Votre ticket a été résolu.',
    ].join('\n');

    expect(stripQuotedReply(texte)).toBe('Merci, c’est réglé.');
  });

  it('coupe à la citation française sans accent', () => {
    // Une passerelle de messagerie peut normaliser le texte : l'attribution
    // arrive alors sans accent, et la citation resterait sinon dans le suivi.
    const texte = ['Rien de neuf.', '', 'Le 6 septembre 2026, Tick& a ecrit :', '> Ouvert.'].join(
      '\n',
    );

    expect(stripQuotedReply(texte)).toBe('Rien de neuf.');
  });

  it('coupe au bloc cité même sans ligne d’attribution', () => {
    expect(stripQuotedReply('Voici la réponse.\n\n> texte précédent')).toBe('Voici la réponse.');
  });

  it('retire la signature', () => {
    const texte = [
      'Bonjour,',
      'Le poste redémarre seul.',
      '--',
      'Paul Durand',
      'Comptabilité',
    ].join('\n');

    expect(stripQuotedReply(texte)).toBe('Bonjour,\nLe poste redémarre seul.');
  });

  it('laisse intact un message sans citation', () => {
    expect(stripQuotedReply('Une seule ligne.')).toBe('Une seule ligne.');
  });
});

describe('adresses et références', () => {
  it('extrait l’adresse du nom affiché', () => {
    expect(bareAddress('Paul Durand <paul@exemple.fr>')).toBe('paul@exemple.fr');
    expect(bareAddress('paul@exemple.fr')).toBe('paul@exemple.fr');
    expect(bareAddress('Paul Durand')).toBeNull();
    expect(bareAddress(null)).toBeNull();
  });

  it('cite le parent direct avant les références plus anciennes', () => {
    const mail = message({
      inReplyTo: '<c@exemple.fr>',
      references: ['<a@exemple.fr>', '<b@exemple.fr>', '<c@exemple.fr>'],
    });

    // Le parent d'abord, puis les références de la plus récente à la plus
    // ancienne : un fil dévié garde la plus proche en dernier.
    expect(citedMessageIds(mail)).toEqual(['<c@exemple.fr>', '<b@exemple.fr>', '<a@exemple.fr>']);
  });
});
