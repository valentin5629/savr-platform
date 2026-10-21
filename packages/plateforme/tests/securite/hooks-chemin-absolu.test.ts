/**
 * Cliquet — chaque hook de `.claude/settings.json` trouve son script et démarre
 * à la racine du dépôt, que la session soit à la racine ou dans un sous-dossier.
 *
 * Claude Code lance un hook par un shell (`/bin/sh -c "<commande>"`), avec
 * `CLAUDE_PROJECT_DIR` dans l'environnement (lu dans son code, version 2.1.304).
 * Deux régimes relevés sur ce poste :
 *   • sans racine de configuration posée par l'hôte : le hook démarre dans le
 *     dossier courant de la session (celui que la commande précédente a laissé),
 *     et `CLAUDE_PROJECT_DIR` vaut le dossier où la session a été ouverte. Mesuré
 *     le 2026-10-21 : le clone principal, pour une session ouverte là puis entrée
 *     dans un worktree, y compris après un changement de dossier par l'app ;
 *   • avec `--project-config-root`, option qu'un hôte pose pour une session qu'il
 *     démarre dans un worktree (l'app de bureau la pose derrière un interrupteur,
 *     lu dans son code) : le hook démarre dans cette racine, que vaut aussi
 *     `CLAUDE_PROJECT_DIR` (lu dans le code de Claude Code ; cohérent avec 74
 *     exécutions de pre-commit-gate jugeant le clone principal pour une session de
 *     worktree, du 2026-10-09 au 2026-10-15, versions 2.1.293 et 2.1.295).
 * Le code en prévoit d'autres, non couverts ici, notamment : session en mode
 * distant (le hook démarre dans le dossier de lancement), dossier courant
 * disparu (repli sur le dossier de lancement, la racine du projet ou le dossier
 * personnel).
 * Jusqu'au 2026-10-21 les commandes étaient relatives (`bash .claude/hooks/x.sh`).
 * Dans le premier régime, depuis un sous-dossier (`packages/plateforme`,
 * `specs/cdc`…), le script était introuvable (code 127), ce que Claude Code
 * traite comme une erreur NON bloquante : la commande partait sans garde. Relevé
 * dans les transcripts du 2026-10-14 0 h au 2026-10-21 13 h 30 (UTC) : 292
 * commandes Bash, dans 14 sessions, passées sans les cinq gardes Bash.
 *
 * Forme imposée à tout hook qui lance un script du dépôt (cf. `forme()`) :
 *   • le script est désigné par "$CLAUDE_PROJECT_DIR" : trouvé de partout ;
 *   • la commande se place d'abord à la racine du dépôt du dossier où le hook
 *     démarre, quand ce dossier est dans un dépôt. Un chemin relatif ne se
 *     résolvait que depuis un dossier portant `.claude/hooks/` (relevé le
 *     2026-10-21 dans le clone principal, hors `node_modules` : sa racine et
 *     celles de ses worktrees, aucun autre dossier) : c'est là que tout hook
 *     trouvé démarrait, et leurs propres chemins relatifs le supposent
 *     (`scripts/check-coupling.sh`, marqueurs `.claude/…`). Mesuré sur un dépôt
 *     jetable le 2026-10-21 : sans ce placement, pre-commit-gate et gate-pr
 *     lancés d'un sous-dossier jugeaient le sous-dossier et bloquaient à tort
 *     (« KO anti-couplage », « check-outbox-contracts échoue »). Dans le second
 *     régime, le hook démarre déjà à une racine : c'est le cas « depuis la
 *     racine » ci-dessous.
 *
 * Les champs de chaque garde sont figés avec elle : un champ ajouté (une
 * condition `if`, par exemple) ou modifié (`timeout`) fait rougir ce cliquet. Le
 * fichier ne porte que `hooks` : un réglage de premier niveau ajouté, comme
 * `disableAllHooks` (il coupe tous les hooks), le fait rougir aussi.
 *
 * Non couvert ici, notamment :
 *   • des hooks déclarés ailleurs (`.claude/settings.local.json`, réglages de
 *     l'utilisateur) ;
 *   • un script de garde vidé. Mesuré le 2026-10-21 : ce cliquet ne le voit que
 *     pour block-destructive (son cas de bout en bout doit bloquer) ; les autres
 *     gardes n'y sont lancées que sur une action anodine, et session-hygiene n'y
 *     est pas lancé ; un script vidé sort aussi en 0 à son `--self-test`, seul
 *     code que la CI lit ;
 *   • une garde dont la sortie bloquante est neutralisée : ici, seule
 *     block-destructive est rejouée sur une commande qui doit bloquer. Mesuré le
 *     2026-10-21 : les auto-tests de block-destructive, db-guard, pre-commit-gate
 *     et gate-pr rejouent le hook entier et rougissent alors ; celui de
 *     gate-merge ne rejoue que ses deux fonctions d'analyse de la commande et
 *     reste vert ; gate-brief, format-file et session-hygiene n'ont pas
 *     d'auto-test ;
 *   • une session dont le dossier `CLAUDE_PROJECT_DIR` a été supprimé (la garde
 *     redevient introuvable, et Claude Code laisse passer).
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const RACINE = resolve(__dirname, '../../../..');
/** Dossiers de départ essayés : la racine et deux sous-dossiers suivis par git. */
const DOSSIERS = ['', 'packages/plateforme', '.claude/hooks'].map((d) =>
  join(RACINE, d),
);
/** Lancer des processus peut être lent sur un poste chargé : marge large. */
const DELAI_MS = 60_000;

type Hook = { type: string; command?: string } & Record<string, unknown>;
type Groupe = { matcher?: string; hooks: Hook[] } & Record<string, unknown>;
type Entree = { evenement: string; matcher?: string; hook: Hook };

const settings = JSON.parse(
  readFileSync(join(RACINE, '.claude/settings.json'), 'utf8'),
) as { hooks: Record<string, Groupe[]> };
const ENTREES: Entree[] = Object.entries(settings.hooks).flatMap(
  ([evenement, groupes]) =>
    groupes.flatMap((g) =>
      g.hooks.map((hook) => ({ evenement, matcher: g.matcher, hook })),
    ),
);

/** La seule commande de hook admise pour lancer `.claude/hooks/<script>`. */
function forme(script: string): string {
  return `racine=$(git rev-parse --show-toplevel 2>/dev/null) && cd "$racine"; bash "$CLAUDE_PROJECT_DIR"/.claude/hooks/${script}`;
}
const SCRIPT_LANCE = /\.claude\/hooks\/([a-z0-9-]+\.sh)$/;

/**
 * Les gardes attendues, dans l'ordre de settings.json : évènement, filtre
 * (`matcher`), script et champs propres (`timeout`…). Ajouter, retirer, déplacer
 * ou échanger une garde, ou changer ses champs, fait rougir ce cliquet : le faire
 * exprès, ici.
 */
const GARDES_ATTENDUES: ReadonlyArray<{
  evenement: string;
  matcher?: string;
  script: string;
  champs?: Record<string, unknown>;
}> = [
  {
    evenement: 'SessionStart',
    script: 'session-hygiene.sh',
    champs: { timeout: 20 },
  },
  {
    evenement: 'PostToolUse',
    matcher: 'Write|Edit',
    script: 'format-file.sh',
  },
  { evenement: 'PreToolUse', matcher: 'Write|Edit', script: 'gate-brief.sh' },
  { evenement: 'PreToolUse', matcher: 'Bash', script: 'db-guard.sh' },
  { evenement: 'PreToolUse', matcher: 'Bash', script: 'block-destructive.sh' },
  { evenement: 'PreToolUse', matcher: 'Bash', script: 'pre-commit-gate.sh' },
  { evenement: 'PreToolUse', matcher: 'Bash', script: 'gate-pr.sh' },
  { evenement: 'PreToolUse', matcher: 'Bash', script: 'gate-merge.sh' },
];

/**
 * Hooks qui ne lancent AUCUN script du dépôt, figés par leur commande, mot pour
 * mot. Un changement de cette commande fait rougir ce cliquet : vérifier alors
 * qu'elle ne lance toujours aucun script par un chemin relatif, puis la recopier
 * ici. Leurs autres champs ne sont pas figés.
 *   • Stop : rappel de mise à jour de la mémoire après un commit. Il lit `git log`
 *     du dossier où il démarre. Son repère `.git/.claude-last-commit-checked` est
 *     relatif à ce dossier : dans un worktree, `.git` est un fichier et
 *     l'écriture échoue (mesuré le 2026-10-21) ; dernier rappel relevé dans les
 *     transcripts : 2026-10-09. Laissé tel quel : le ranimer est une décision à
 *     part.
 */
const SANS_SCRIPT: ReadonlyArray<{ evenement: string; commande: string }> = [
  {
    evenement: 'Stop',
    commande: `bash -c 'last=$(git log -1 --format="%H" 2>/dev/null); [ -z "$last" ] && exit 0; marker=".git/.claude-last-commit-checked"; [ -f "$marker" ] && [ "$(cat $marker)" = "$last" ] && exit 0; recent=$(git log --since="90 seconds ago" --oneline 2>/dev/null | wc -l | tr -d " "); [ "$recent" -gt 0 ] && echo "$last" > "$marker" && exit 2 || exit 0'`,
  },
];
const estFige = (e: Entree) =>
  SANS_SCRIPT.some(
    (f) => f.evenement === e.evenement && f.commande === e.hook.command,
  );

/** Tout hook non figé doit lancer un script dans la forme imposée. */
const AVEC_SCRIPT = ENTREES.filter((e) => !estFige(e));

/** Lance une commande de hook comme Claude Code : un shell, un dossier de départ, CLAUDE_PROJECT_DIR. */
function lancer(
  commande: string,
  dossier: string,
  projet: string,
  charge: object,
) {
  const r = spawnSync('/bin/sh', ['-c', commande], {
    cwd: dossier,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projet },
    input: JSON.stringify(charge),
    encoding: 'utf8',
    timeout: DELAI_MS,
  });
  return { code: r.status, sortie: r.stdout, erreur: r.stderr };
}

/** Une action anodine, dans la forme que reçoit le hook (commande Bash ou fichier écrit). */
function chargeAnodine({ matcher }: Entree, dossier: string): object {
  return matcher === 'Bash'
    ? { tool_input: { command: 'ls' }, cwd: dossier }
    : {
        tool_input: { file_path: join(tmpdir(), 'hors-depot.txt') },
        cwd: dossier,
      };
}

/** Projet factice : chaque script de hook y est un témoin qui dit où il démarre. */
const factice = mkdtempSync(join(tmpdir(), 'hooks-chemin-absolu-'));
afterAll(() => rmSync(factice, { recursive: true, force: true }));
function projetFactice(): string {
  mkdirSync(join(factice, 'projet/.claude/hooks'), { recursive: true });
  for (const { hook } of AVEC_SCRIPT) {
    const script = SCRIPT_LANCE.exec(hook.command ?? '')?.[1];
    if (!script) continue;
    const chemin = join(factice, 'projet/.claude/hooks', script);
    writeFileSync(
      chemin,
      `#!/bin/sh\ncat > /dev/null\necho "${script} @ $(pwd -P)"\n`,
    );
    chmodSync(chemin, 0o755);
  }
  return join(factice, 'projet');
}

describe('hooks de .claude/settings.json — script trouvé et démarrage à la racine du dépôt, depuis la racine ou un sous-dossier', () => {
  it('les gardes attendues sont là, dans l’ordre, chacune sur son évènement et avec ses seuls champs', () => {
    expect(ENTREES.every((e) => e.hook.type === 'command')).toBe(true);
    // Le fichier ne porte que `hooks` : `disableAllHooks`, par exemple, les couperait tous.
    expect(Object.keys(settings)).toEqual(['hooks']);
    // Un groupe ne porte qu'un filtre et ses hooks : rien qui puisse en écarter un.
    for (const [evenement, groupes] of Object.entries(settings.hooks)) {
      for (const g of groupes) {
        expect({
          evenement,
          autresCles: Object.keys(g).filter(
            (k) => k !== 'matcher' && k !== 'hooks',
          ),
        }).toEqual({ evenement, autresCles: [] });
      }
    }
    expect(
      AVEC_SCRIPT.map((e) => ({
        evenement: e.evenement,
        ...(e.matcher === undefined ? {} : { matcher: e.matcher }),
        hook: e.hook,
      })),
    ).toEqual(
      GARDES_ATTENDUES.map(({ evenement, matcher, script, champs }) => ({
        evenement,
        ...(matcher === undefined ? {} : { matcher }),
        hook: { type: 'command', command: forme(script), ...champs },
      })),
    );
  });

  it.each(
    AVEC_SCRIPT.map(
      (e) =>
        [
          `${e.evenement} ${e.matcher ?? ''}`.trim(),
          e.hook.command ?? '',
        ] as const,
    ),
  )(
    '%s : forme imposée, script présent dans le dépôt — %s',
    (_libelle, commande) => {
      const script = SCRIPT_LANCE.exec(commande)?.[1];
      expect(
        script,
        `aucun script .claude/hooks/<nom>.sh lancé par : ${commande}`,
      ).toBeDefined();
      expect(commande).toBe(forme(script!));
      expect(
        existsSync(join(RACINE, '.claude/hooks', script!)),
        `${script} absent de .claude/hooks/`,
      ).toBe(true);
    },
  );

  it('les hooks figés sans script sont tous présents, mot pour mot', () => {
    expect(
      ENTREES.filter(estFige).map((e) => ({
        evenement: e.evenement,
        commande: e.hook.command,
      })),
    ).toEqual(SANS_SCRIPT);
  });

  it(
    'depuis la racine et deux sous-dossiers, chaque commande trouve son script et le lance à la racine du dépôt',
    () => {
      const projet = projetFactice();
      const racinePhysique = realpathSync(RACINE);
      for (const dossier of DOSSIERS) {
        for (const entree of AVEC_SCRIPT) {
          const script = SCRIPT_LANCE.exec(entree.hook.command!)![1];
          const r = lancer(
            entree.hook.command!,
            dossier,
            projet,
            chargeAnodine(entree, dossier),
          );
          expect({
            dossier,
            script,
            code: r.code,
            sortie: r.sortie.trim(),
          }).toEqual({
            dossier,
            script,
            code: 0,
            sortie: `${script} @ ${racinePhysique}`,
          });
        }
      }
    },
    DELAI_MS,
  );

  it(
    'hors de tout dépôt, chaque commande trouve encore son script et démarre là où elle est lancée',
    () => {
      const projet = projetFactice();
      const horsDepot = realpathSync(mkdtempSync(join(factice, 'hors-depot-')));
      // Garde anti-vacuité : ce dossier ne doit appartenir à aucun dépôt git.
      expect(
        spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: horsDepot })
          .status,
        `${horsDepot} appartient à un dépôt git : ce cas ne prouverait rien`,
      ).not.toBe(0);
      for (const entree of AVEC_SCRIPT) {
        const script = SCRIPT_LANCE.exec(entree.hook.command!)![1];
        const r = lancer(
          entree.hook.command!,
          horsDepot,
          projet,
          chargeAnodine(entree, horsDepot),
        );
        expect({ script, code: r.code, sortie: r.sortie.trim() }).toEqual({
          script,
          code: 0,
          sortie: `${script} @ ${horsDepot}`,
        });
      }
    },
    DELAI_MS,
  );

  it(
    'de bout en bout : depuis la racine et deux sous-dossiers, la vraie garde destructive bloque, et laisse passer une commande anodine',
    () => {
      const commande = AVEC_SCRIPT.find((e) =>
        e.hook.command?.endsWith('/block-destructive.sh'),
      )!.hook.command!;
      const destructive = ['trunc', 'ate plateforme.t'].join('');
      for (const dossier of DOSSIERS) {
        expect({
          dossier,
          code: lancer(commande, dossier, RACINE, {
            tool_input: { command: destructive },
          }).code,
        }).toEqual({ dossier, code: 2 });
        expect({
          dossier,
          code: lancer(commande, dossier, RACINE, {
            tool_input: { command: 'ls' },
          }).code,
        }).toEqual({ dossier, code: 0 });
      }
    },
    DELAI_MS,
  );

  it(
    'de bout en bout : depuis la racine et deux sous-dossiers, chaque vraie garde (sauf session-hygiene) tourne et rend 0 sur une action anodine',
    () => {
      // session-hygiene n'est pas lancé : il purge des branches et des worktrees.
      for (const dossier of DOSSIERS) {
        for (const entree of AVEC_SCRIPT.filter(
          (e) => e.evenement !== 'SessionStart',
        )) {
          const r = lancer(
            entree.hook.command!,
            dossier,
            RACINE,
            chargeAnodine(entree, dossier),
          );
          expect({
            dossier,
            commande: entree.hook.command,
            code: r.code,
            erreur: r.erreur,
          }).toEqual({
            dossier,
            commande: entree.hook.command,
            code: 0,
            erreur: '',
          });
        }
      }
    },
    DELAI_MS,
  );

  it(
    'témoin : la forme d’avant, lancée de packages/plateforme, ne trouvait pas son script (code 127)',
    () => {
      // Sans ce témoin, les cas ci-dessus pourraient passer dans un environnement
      // où un chemin relatif se résoudrait quand même : ils ne prouveraient rien.
      const r = lancer(
        'bash .claude/hooks/block-destructive.sh',
        join(RACINE, 'packages/plateforme'),
        RACINE,
        { tool_input: { command: ['trunc', 'ate plateforme.t'].join('') } },
      );
      expect(r.code).toBe(127);
      expect(r.erreur).toContain('No such file or directory');
    },
    DELAI_MS,
  );
});
