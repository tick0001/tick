import { describe, expect, it } from 'vitest';
import { toCsv, toPdf, type Colonne } from './export.js';

const COLONNES: readonly Colonne[] = [
  { key: 'id', label: 'N°' },
  { key: 'name', label: 'Sujet' },
];

describe('Export CSV', () => {
  it('encadre et double les guillemets', () => {
    const sortie = toCsv(COLONNES, [{ id: 1, name: 'Panne "urgente", 2e etage' }]);

    expect(sortie).toContain('1,"Panne ""urgente"", 2e etage"');
  });

  it('neutralise une valeur qui commence par un signe de formule', () => {
    // Sans cela, le tableur qui ouvre le fichier évalue la cellule : c'est un
    // vecteur d'injection connu, et il passe par un simple titre de ticket.
    const sortie = toCsv(COLONNES, [{ id: 1, name: '=1+1' }]);

    expect(sortie).toContain("1,'=1+1");
  });

  it('commence par une marque d’ordre des octets et sépare par CRLF', () => {
    const sortie = toCsv(COLONNES, [{ id: 1, name: 'Test' }]);

    expect(sortie.codePointAt(0)).toBe(0xfe_ff);
    expect(sortie).toContain('\r\n');
  });

  it('rend une colonne absente comme vide plutôt que « undefined »', () => {
    const sortie = toCsv(COLONNES, [{ id: 1 }]);

    expect(sortie.trim().endsWith('1,')).toBe(true);
  });
});

describe('Export PDF', () => {
  /** Positions déclarées par la table de références croisées. */
  function offsets(document: Buffer): number[] {
    const texte = document.toString('latin1');
    const depart = Number(/startxref\s+(\d+)/.exec(texte)?.[1] ?? 0);
    const bloc = texte.slice(depart).split('trailer')[0] ?? '';

    return bloc
      .split('\n')
      .filter((ligne) => ligne.endsWith(' n '))
      .map((ligne) => Number(ligne.split(' ')[0]));
  }

  it('produit un document dont chaque position pointe sur son objet', () => {
    const document = toPdf('Rapport', COLONNES, [{ id: 1, name: 'Panne imprimante' }]);

    expect(document.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    expect(document.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true);

    offsets(document).forEach((position, index) => {
      const attendu = `${String(index + 1)} 0 obj`;

      expect(document.subarray(position, position + attendu.length).toString('latin1')).toBe(
        attendu,
      );
    });
  });

  it('échappe les parenthèses, qui casseraient le document entier', () => {
    const document = toPdf('Rapport', COLONNES, [{ id: 1, name: 'Panne (imprimante)' }]);

    expect(document.toString('latin1')).toContain('Panne \\(imprimante\\)');
  });

  it('pagine au-delà d’une page', () => {
    const lignes = Array.from({ length: 200 }, (_, index) => ({
      id: index + 1,
      name: `Ticket ${String(index + 1)}`,
    }));
    const document = toPdf('Rapport', COLONNES, lignes);
    const pages = document.toString('latin1').match(/\/Type \/Page /g) ?? [];

    expect(pages.length).toBeGreaterThan(1);
  });

  it('remplace un caractère hors WinAnsi plutôt que d’écrire un glyphe faux', () => {
    const document = toPdf('Rapport', COLONNES, [{ id: 1, name: 'Panne 🖨 imprimante' }]);
    const texte = document.toString('latin1');

    expect(texte).toContain('Panne ?');
    // Les accents latins, eux, passent tels quels.
    expect(toPdf('Éch', COLONNES, []).toString('latin1')).toContain('Éch');
  });
});
