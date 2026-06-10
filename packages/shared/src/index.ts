export type TypeCollecte = 'ag' | 'zd';

export function libelleTypeCollecte(type: TypeCollecte): string {
  return type === 'ag' ? 'Anti-Gaspi' : 'Zéro Déchet';
}
