#!/usr/bin/env node
/**
 * scripts/test-module.ts
 * Lance vitest en filtrant par préfixe de module (ex: "M0.3", "M1.1 ZD").
 * Usage : pnpm test:module M0.3
 *         pnpm test:module "M1.1 ZD"
 */
import { execSync } from 'node:child_process';

const pattern = process.argv[2];
if (!pattern) {
  console.error('Usage: pnpm test:module <MODULE_PREFIX>');
  console.error('  ex: pnpm test:module M0.3');
  process.exit(1);
}

// On filtre par le titre du test via --reporter=verbose + --testNamePattern
const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cmd = `vitest run --reporter=verbose --testNamePattern="^${escaped}"`;

console.log(`▶  vitest run --testNamePattern="^${escaped}"`);
try {
  execSync(cmd, { stdio: 'inherit' });
} catch {
  process.exit(1);
}
