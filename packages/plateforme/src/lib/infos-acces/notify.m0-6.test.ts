import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setEmailCaptureSink,
  type CapturedEmail,
} from '@savr/shared/src/email/index.js';
import {
  evaluerInfosAccesEtEnvoyer,
  renderChauffeursBloc,
  type InfosAccesChauffeur,
} from './notify.js';

type RpcResult = { data: unknown; error: { message: string } | null };

// Supabase minimal : .rpc(...) renvoie le résultat fixé ; .from().update().eq()
// no-op (chemin de relâchement du claim, non exercé ici).
function makeSupabase(rpcResult: RpcResult) {
  return {
    rpc: async () => rpcResult,
    from: () => ({
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  } as unknown as Parameters<typeof evaluerInfosAccesEtEnvoyer>[0];
}

const PAYLOAD_COMPLET = {
  to: 'prog@infos-acces.local',
  prenom: 'Prog',
  evenement_nom: 'Gala',
  date_collecte: '2026-09-10',
  heure_collecte: '08:00:00',
  lieu_nom: 'Salle Accès',
  lieu_adresse: '9 rue Test',
  chauffeurs: [
    {
      rang: 1,
      chauffeur_nom: 'Jean Dupont',
      chauffeur_telephone: '0611111111',
      plaque: '12ABC23',
      accompagnant_nom: null,
      accompagnant_telephone: null,
    },
    {
      rang: 2,
      chauffeur_nom: 'Marie Martin',
      chauffeur_telephone: '0622222222',
      plaque: '34XYZ56',
      accompagnant_nom: 'Luc Bernard',
      accompagnant_telephone: '0633333333',
    },
  ] satisfies InfosAccesChauffeur[],
};

describe('M0.6 / infos accès — email récap (evaluerInfosAccesEtEnvoyer)', () => {
  let emails: CapturedEmail[] = [];
  beforeEach(() => {
    emails = [];
    setEmailCaptureSink((e) => emails.push(e));
  });
  afterEach(() => setEmailCaptureSink(null));

  it('complet → envoie 1 email au programmateur avec les infos formatées', async () => {
    const supabase = makeSupabase({ data: PAYLOAD_COMPLET, error: null });
    const res = await evaluerInfosAccesEtEnvoyer(supabase, 'coll-1');

    expect(res.envoye).toBe(true);
    expect(emails).toHaveLength(1);
    const email = emails[0]!;
    expect(email.slug).toBe('infos_acces_collecte');
    expect(email.to).toBe('prog@infos-acces.local');
    // Date/heure formatées FR.
    expect(email.variables.date_collecte).toBe('10/09/2026');
    expect(email.variables.heure_collecte).toBe('08:00');
    // Bloc chauffeurs pré-rendu, un email listant les 2 camions.
    const bloc = email.variables.chauffeurs_bloc;
    expect(bloc).toContain('Jean Dupont');
    expect(bloc).toContain('0611111111');
    expect(bloc).toContain('Marie Martin');
    expect(bloc).toContain('Luc Bernard');
  });

  it('RPC null (incomplet / déjà envoyé) → aucun email', async () => {
    const supabase = makeSupabase({ data: null, error: null });
    const res = await evaluerInfosAccesEtEnvoyer(supabase, 'coll-1');
    expect(res.envoye).toBe(false);
    expect(emails).toHaveLength(0);
  });

  it('destinataire introuvable → aucun email (pas d’envoi à vide)', async () => {
    const supabase = makeSupabase({
      data: { erreur: 'destinataire_introuvable' },
      error: null,
    });
    const res = await evaluerInfosAccesEtEnvoyer(supabase, 'coll-1');
    expect(res.envoye).toBe(false);
    expect(emails).toHaveLength(0);
  });

  it('erreur RPC → aucun email, pas d’exception', async () => {
    const supabase = makeSupabase({
      data: null,
      error: { message: 'boom' },
    });
    const res = await evaluerInfosAccesEtEnvoyer(supabase, 'coll-1');
    expect(res.envoye).toBe(false);
    expect(emails).toHaveLength(0);
  });

  it('échec envoi Resend → relâche le claim (reset infos_acces_email_envoye_at) + envoye=false', async () => {
    const updateCalls: unknown[] = [];
    const supabase = {
      rpc: async () => ({ data: PAYLOAD_COMPLET, error: null }),
      from: () => ({
        update: (v: unknown) => {
          updateCalls.push(v);
          return { eq: async () => ({ error: null }) };
        },
      }),
    } as unknown as Parameters<typeof evaluerInfosAccesEtEnvoyer>[0];
    // Sink qui échoue → sendEmail throw → chemin de relâchement du claim.
    setEmailCaptureSink(() => {
      throw new Error('resend down');
    });

    const res = await evaluerInfosAccesEtEnvoyer(supabase, 'coll-1');
    expect(res.envoye).toBe(false);
    expect(updateCalls).toContainEqual({ infos_acces_email_envoye_at: null });
  });
});

describe('M0.6 / infos accès — renderChauffeursBloc', () => {
  it('camion unique → pas de titre « Camion N », affiche chauffeur + plaque', () => {
    const bloc = renderChauffeursBloc([
      {
        rang: 1,
        chauffeur_nom: 'Jean Dupont',
        chauffeur_telephone: '0611111111',
        plaque: '12ABC23',
        accompagnant_nom: null,
        accompagnant_telephone: null,
      },
    ]);
    expect(bloc).not.toContain('Camion 1');
    expect(bloc).toContain('Jean Dupont');
    expect(bloc).toContain('12ABC23');
  });

  it('multi-camions → titres « Camion N » + accompagnant listé', () => {
    const bloc = renderChauffeursBloc(PAYLOAD_COMPLET.chauffeurs);
    expect(bloc).toContain('Camion 1');
    expect(bloc).toContain('Camion 2');
    expect(bloc).toContain('Accompagnant : Luc Bernard');
  });

  it('échappe le HTML des valeurs saisies (anti-injection)', () => {
    const bloc = renderChauffeursBloc([
      {
        rang: 1,
        chauffeur_nom: '<script>x</script>',
        chauffeur_telephone: '06',
        plaque: null,
        accompagnant_nom: null,
        accompagnant_telephone: null,
      },
    ]);
    expect(bloc).not.toContain('<script>');
    expect(bloc).toContain('&lt;script&gt;');
  });
});
