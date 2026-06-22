import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { isDisposableEmail } from '@savr/shared/src/email-denylist.js';
import { sendEmail } from '@savr/shared/src/email/index.js';
import { verifySiret } from '@savr/shared/src/api/siret.js';
import { verifyTva } from '@savr/shared/src/api/tva.js';
import {
  checkSignupRateLimit,
  extractClientIp,
} from '@/lib/signup-rate-limit.js';

const TYPE_PROFIL = ['traiteur', 'agence', 'gestionnaire_lieux'] as const;
type TypeProfil = (typeof TYPE_PROFIL)[number];

function rolePourDomainePropriete(type: TypeProfil): string {
  if (type === 'traiteur') return 'traiteur_manager';
  return type; // agence | gestionnaire_lieux
}

function rolePourDomaineConu(orgType: string): string {
  if (orgType === 'traiteur') return 'traiteur_commercial';
  return orgType; // agence | gestionnaire_lieux
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Rate-limit best-effort en amont de tout travail DB (§15 §2.6 : max 5/IP/heure).
  const rl = checkSignupRateLimit(extractClientIp(req));
  if (rl.limited) {
    return NextResponse.json(
      { error: 'Trop de tentatives. Réessayez plus tard.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSeconds) },
      },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const {
    email,
    mot_de_passe,
    prenom,
    nom,
    telephone,
    type_profil,
    raison_sociale,
    acceptation_cgu,
  } = body as {
    email?: string;
    mot_de_passe?: string;
    prenom?: string;
    nom?: string;
    telephone?: string;
    type_profil?: string;
    raison_sociale?: string;
    acceptation_cgu?: boolean;
  };

  // Validation champs obligatoires
  if (
    !email ||
    !mot_de_passe ||
    !prenom ||
    !nom ||
    !telephone ||
    !type_profil ||
    !raison_sociale
  ) {
    return NextResponse.json(
      { error: 'Champs obligatoires manquants' },
      { status: 422 },
    );
  }
  if (!acceptation_cgu) {
    return NextResponse.json(
      { error: 'Acceptation CGU obligatoire' },
      { status: 422 },
    );
  }
  if (!TYPE_PROFIL.includes(type_profil as TypeProfil)) {
    return NextResponse.json(
      { error: 'type_profil invalide' },
      { status: 422 },
    );
  }

  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (!domain) {
    return NextResponse.json({ error: 'Email invalide' }, { status: 422 });
  }

  // Domaine jetable → 422
  if (isDisposableEmail(domain)) {
    return NextResponse.json(
      { error: 'Adresse email jetable non autorisée' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();

  // Vérifier si domaine public (bypass rattachement automatique)
  const { data: publicRow } = await supabase
    .from('domaines_email_publics')
    .select('domaine')
    .eq('domaine', domain)
    .maybeSingle();
  const isPublicDomain = !!publicRow;

  let organisationId: string;
  let userRole: string;
  let orgCreee = false; // true si l'organisation a été créée dans cette requête

  if (!isPublicDomain) {
    // Chercher une org avec ce domaine email reconnu
    const { data: domainRow } = await supabase
      .from('organisations_domaines_email')
      .select('organisation_id, organisations(type)')
      .eq('domaine', domain)
      .maybeSingle();

    if (domainRow?.organisation_id) {
      // Rattachement automatique
      organisationId = domainRow.organisation_id;
      const rawOrg = domainRow.organisations as
        | { type: string }
        | { type: string }[]
        | null;
      const orgType =
        (Array.isArray(rawOrg) ? rawOrg[0] : rawOrg)?.type ?? type_profil;
      userRole = rolePourDomaineConu(orgType);
    } else {
      // Nouveau domaine pro → créer orga
      const { organisationId: id, role } = await creerNouvelleOrga(
        supabase,
        raison_sociale,
        type_profil as TypeProfil,
        domain,
        telephone,
      );
      organisationId = id;
      userRole = role;
      orgCreee = true;
    }
  } else {
    // Domaine public → orga isolée sans rattachement
    const { organisationId: id, role } = await creerNouvelleOrga(
      supabase,
      raison_sociale,
      type_profil as TypeProfil,
      null,
      telephone,
    );
    organisationId = id;
    userRole = role;
    orgCreee = true;
  }

  // Créer le compte Supabase Auth
  const { data: authData, error: authError } =
    await supabase.auth.admin.createUser({
      email,
      password: mot_de_passe,
      email_confirm: false,
      user_metadata: { prenom, nom },
    });

  if (authError || !authData.user) {
    // Rollback organisation si nouvellement créée (best-effort)
    if (orgCreee) await rollbackOrganisation(supabase, organisationId);
    return NextResponse.json(
      { error: authError?.message ?? 'Erreur création compte' },
      { status: 422 },
    );
  }

  const userId = authData.user.id;

  // Créer le profil plateforme.users
  const { error: userError } = await supabase.from('users').insert({
    id: userId,
    organisation_id: organisationId,
    email,
    prenom,
    nom,
    role: userRole,
  });

  if (userError) {
    // Rollback : compte Auth + organisation nouvellement créée (best-effort)
    await supabase.auth.admin.deleteUser(userId).catch(() => null);
    if (orgCreee) await rollbackOrganisation(supabase, organisationId);
    return NextResponse.json({ error: userError.message }, { status: 422 });
  }

  // Générer le lien de vérification et envoyer via Resend
  const { data: linkData } = await supabase.auth.admin.generateLink({
    type: 'signup',
    email,
    password: mot_de_passe,
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/auth/verify-email`,
    },
  });
  const hashedToken = linkData?.properties?.hashed_token;
  if (hashedToken) {
    const verifyUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/auth/verify-email?token_hash=${hashedToken}&type=signup`;
    void sendEmail('verification_email', email, {
      prenom: prenom ?? '',
      lien_verification: verifyUrl,
    }).catch(() => null);
  }

  // Lancer la vérification INSEE de manière asynchrone (jamais bloquante)
  void lancerVerificationInsee(supabase, organisationId).catch(() => null);

  return NextResponse.json(
    { success: true, organisation_id: organisationId },
    { status: 201 },
  );
}

async function creerNouvelleOrga(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  raisonSociale: string,
  typeProfil: TypeProfil,
  domain: string | null,
  telephone: string,
): Promise<{ organisationId: string; role: string }> {
  const { data: org, error } = await supabase
    .from('organisations')
    .insert({
      // `nom` = nom usuel (NOT NULL sans default). À l'inscription on ne collecte
      // que la raison sociale → nom = raison_sociale (fallback documenté §04).
      nom: raisonSociale,
      raison_sociale: raisonSociale,
      type: typeProfil,
      telephone,
    })
    .select('id')
    .single();

  if (error || !org) throw new Error('Erreur création organisation');

  // Créer l'entité de facturation par défaut (siret_verification='en_attente')
  await supabase.from('entites_facturation').insert({
    organisation_id: org.id,
    raison_sociale: raisonSociale,
    siret: '',
    adresse_facturation: '',
    code_postal: '',
    ville: '',
    entite_par_defaut: true,
    siret_verification: 'en_attente',
    tva_verification: 'en_attente',
  });

  // Enregistrer le domaine email si non-public et non-null
  if (domain) {
    try {
      await supabase
        .from('organisations_domaines_email')
        .insert({ organisation_id: org.id, domaine: domain });
    } catch {
      // ignore si domaine déjà pris (race condition)
    }
  }

  return {
    organisationId: org.id,
    role: rolePourDomainePropriete(typeProfil),
  };
}

async function rollbackOrganisation(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  organisationId: string,
): Promise<void> {
  // Best-effort : supprimer les lignes filles AVANT l'organisation
  // (FK sans ON DELETE CASCADE → l'ordre compte). Erreurs ignorées.
  try {
    await supabase
      .from('organisations_domaines_email')
      .delete()
      .eq('organisation_id', organisationId);
    await supabase
      .from('entites_facturation')
      .delete()
      .eq('organisation_id', organisationId);
    await supabase.from('organisations').delete().eq('id', organisationId);
  } catch {
    // ignore : rollback best-effort
  }
}

async function lancerVerificationInsee(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  organisationId: string,
): Promise<void> {
  // Récupérer le SIRET de l'entité de facturation
  const { data } = await supabase
    .from('entites_facturation')
    .select('id, siret, tva_intracom')
    .eq('organisation_id', organisationId)
    .eq('entite_par_defaut', true)
    .maybeSingle();

  if (!data?.siret) return;

  const [siretResult, tvaResult] = await Promise.all([
    verifySiret(data.siret),
    verifyTva(data.tva_intracom ?? null),
  ]);

  await supabase
    .from('entites_facturation')
    .update({
      siret_verification: siretResult === 'down' ? 'en_attente' : siretResult,
      siret_verifie_le:
        siretResult !== 'down' ? new Date().toISOString() : null,
      tva_verification: tvaResult === 'down' ? 'en_attente' : tvaResult,
      tva_verifiee_le:
        tvaResult !== 'down' && tvaResult !== 'non_applicable'
          ? new Date().toISOString()
          : null,
    })
    .eq('id', data.id);
}
