#!/usr/bin/env node
/**
 * scripts/test-module.ts
 * Lance vitest en filtrant par préfixe(s) de module.
 * R0d : VARIADIQUE — un lot de remédiation touche souvent PLUSIEURS modules
 * (R1=M1.5+M1.8, R2=M1.6+M2.4+M1.5…). Un seul préfixe laissait les autres
 * modules du lot jamais exécutés alors que /goal passait au vert.
 *
 * Usage : pnpm test:module M0.3
 *         pnpm test:module M1.5 M1.8
 *         pnpm test:module "M1.1 ZD"
 */
import { execSync } from 'node:child_process';

const patterns = process.argv.slice(2);
if (patterns.length === 0) {
  console.error('Usage: pnpm test:module <MODULE_PREFIX> [MODULE_PREFIX...]');
  console.error('  ex: pnpm test:module M1.5 M1.8');
  process.exit(1);
}

// Échappe chaque préfixe puis assemble une alternance ancrée au début du titre.
const escaped = patterns
  .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
const namePattern = `^(${escaped})`;
const cmd = `vitest run --reporter=verbose --testNamePattern="${namePattern}"`;

console.log(`▶  vitest run --testNamePattern="${namePattern}"`);
try {
  execSync(cmd, { stdio: 'inherit' });
} catch {
  process.exit(1);
}
