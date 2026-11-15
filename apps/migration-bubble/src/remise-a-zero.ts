/**
 * Remise à zéro (06 - Plan de rollback §5) : retire de la base tout ce que
 * l'import y a écrit, et rien d'autre. Les lignes sont retrouvées par la table
 * de correspondance `migration.id_map`, dans l'ordre inverse des dépendances ;
 * référentiels, comptes de l'équipe et organisation Savr préexistante restent.
 */
import {
  basculerDeclencheurs,
  exigerDeclencheursActifs,
  type Requeteur,
} from './base';
import { TABLES_CIBLES } from './plan';

export async function remettreAZero(
  client: Requeteur,
): Promise<Record<string, number>> {
  const retirees: Record<string, number> = {};
  const { rows } = await client.query(
    `SELECT to_regclass('migration.id_map') IS NOT NULL AS presente`,
  );
  if (rows[0]?.presente !== true) return retirees;
  await client.query('BEGIN');
  try {
    await basculerDeclencheurs(client, 'DISABLE');
    const retirer = async (table: string, cle: string, cible: string) => {
      const { rowCount } = await client.query(
        `DELETE FROM ${table} t
          WHERE t.${cle} IN (SELECT m.target_id FROM migration.id_map m
                              WHERE m.target_table = $1)`,
        [cible],
      );
      retirees[table] = rowCount ?? 0;
    };
    for (const table of [...TABLES_CIBLES].reverse()) {
      if (table === 'collecte_contacts')
        await retirer(
          'plateforme.collecte_contacts',
          'collecte_id',
          'collectes',
        );
      else await retirer(`plateforme.${table}`, 'id', table);
      // Fiches prestataires créées par le déclencheur des transporteurs importés.
      if (table === 'transporteurs')
        await retirer('shared.prestataires', 'id', 'shared.prestataires');
    }
    await basculerDeclencheurs(client, 'ENABLE');
    await exigerDeclencheursActifs(client);
    for (const table of [
      'id_map',
      'rejets',
      'sources_brutes',
      'auteurs_evenements',
    ])
      await client.query(`DELETE FROM migration.${table}`);
    await client.query('COMMIT');
    return retirees;
  } catch (erreur) {
    await client.query('ROLLBACK');
    throw erreur;
  }
}
