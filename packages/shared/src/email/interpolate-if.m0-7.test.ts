/**
 * M0.7 / BL-P2-22 — Interpolateur conditionnel {{#if var}}…{{/if}}.
 * =============================================================================
 * R22f : les templates tiers/conditionnels (20/21/22/9, CDC §06.02) portent des
 * blocs {{#if}} pilotés par des booléens (niveau_bas/epuise, est_modification/
 * est_annulation, annulation_tardive). Ce fichier prouve :
 *  - le bloc est rendu SSI la condition est truthy, omis sinon ;
 *  - le remplacement {{var}} historique reste intact (non-régression) ;
 *  - findMissingVariables n'exige PAS les booléens de bloc ni le contenu de
 *    branche → un envoi de la branche inactive n'est jamais refusé à tort.
 * =============================================================================
 */
import { describe, it, expect } from 'vitest';
import { interpolate, findMissingVariables } from './index.js';

describe('M0.7/bl-p2-22-interpolateur-if — rendu conditionnel', () => {
  const TPL =
    'La collecte a été {{type_changement_libelle}}.' +
    '{{#if est_modification}}Modifications : {{diff_list}}{{/if}}' +
    "{{#if est_annulation}}Elle n'aura pas lieu.{{/if}}";

  it('rend le bloc quand la condition est truthy et remplace ses variables', () => {
    const out = interpolate(TPL, {
      type_changement_libelle: 'modifiée',
      est_modification: 'true',
      est_annulation: 'false',
      diff_list: '- date',
    });
    expect(out).toBe('La collecte a été modifiée.Modifications : - date');
  });

  it('omet le bloc quand la condition est falsy', () => {
    const out = interpolate(TPL, {
      type_changement_libelle: 'annulée',
      est_modification: 'false',
      est_annulation: 'true',
      diff_list: '',
    });
    expect(out).toBe("La collecte a été annulée.Elle n'aura pas lieu.");
  });

  it('traite undefined / vide / "0" / "non" comme falsy', () => {
    for (const v of [undefined, '', '0', 'non', ' false ']) {
      const vars: Record<string, string> = {};
      if (v !== undefined) vars['flag'] = v;
      expect(interpolate('{{#if flag}}X{{/if}}', vars)).toBe('');
    }
  });

  it('traite toute autre valeur non vide comme truthy', () => {
    for (const v of ['true', '1', 'oui', 'epuise']) {
      expect(interpolate('{{#if flag}}X{{/if}}', { flag: v })).toBe('X');
    }
  });

  it('gère plusieurs blocs séquentiels indépendamment', () => {
    const tpl = '{{#if a}}A{{/if}}-{{#if b}}B{{/if}}';
    expect(interpolate(tpl, { a: 'true', b: 'false' })).toBe('A-');
    expect(interpolate(tpl, { a: 'false', b: 'true' })).toBe('-B');
  });
});

describe('M0.7/bl-p2-22-interpolateur-plat — non-régression', () => {
  it('remplace les {{var}} simples et laisse vide un placeholder absent', () => {
    expect(
      interpolate('Bonjour {{prenom}}, {{absent}}', { prenom: 'Alice' }),
    ).toBe('Bonjour Alice, ');
  });

  it('un template sans {{#if}} est inchangé par la logique de bloc', () => {
    const tpl = '<p>Bienvenue {{prenom}}</p><p>{{message}}</p>';
    expect(interpolate(tpl, { prenom: 'Bob', message: 'Coucou' })).toBe(
      '<p>Bienvenue Bob</p><p>Coucou</p>',
    );
  });
});

describe('M0.7/bl-p2-22-missing-vars — booléens de bloc ignorés', () => {
  const TPL =
    'Bonjour {{prenom}}. Collecte {{type_changement_libelle}}.' +
    '{{#if est_modification}}Détails : {{diff_list}}{{/if}}' +
    '{{#if est_annulation}}Annulée.{{/if}}';
  // Ce que le seed déclare comme "variables" (liste documentée CDC).
  const REQUIRED = [
    'prenom',
    'type_changement_libelle',
    'est_modification',
    'est_annulation',
    'diff_list',
  ];

  it('n’exige ni les booléens de bloc ni le contenu de branche (branche annulation)', () => {
    // Cas annulation : ni est_modification, ni est_annulation, ni diff_list fournis.
    const missing = findMissingVariables(
      REQUIRED,
      { prenom: 'Alice', type_changement_libelle: 'annulée' },
      TPL,
    );
    expect(missing).toEqual([]);
  });

  it('exige toujours une variable présente HORS de tout bloc', () => {
    const missing = findMissingVariables(
      REQUIRED,
      { prenom: 'Alice' }, // type_changement_libelle (hors bloc) manquant
      TPL,
    );
    expect(missing).toEqual(['type_changement_libelle']);
  });

  it('conserve le contrôle historique quand le template est plat', () => {
    const missing = findMissingVariables(
      ['prenom', 'lien'],
      { prenom: 'Bob' },
      'Bonjour {{prenom}}, voir {{lien}}',
    );
    expect(missing).toEqual(['lien']);
  });
});
