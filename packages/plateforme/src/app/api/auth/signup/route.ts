import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { isDisposableEmail } from '@savr/shared/src/email-denylist.js';
import { sendEmail } from '@savr/shared/src/email/index.js';
import { verifySiret, isValidSiretFormat } from '@savr/shared/src/api/siret.js';
import { enqueueSiretRevalidation } from '@savr/shared/src/siret/revalidation.js';
import {
  checkSignupRateLimit,
  extractClientIp,
} from '@/lib/signup-rate-limit.js';
import { validatePasswordStrength } from '@/lib/password.js';
import { CGU_VERSION_COURANTE } from '@/lib/cgu.js';

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

// Résultat de création d'organisation : succès (avec l'id de l'entité de facturation
// créée, nécessaire pour enqueue revalidation) ou échec typé mappé en HTTP par le POST.
type CreationOrgaResult =
  | {
      ok: true;
      organisationId: string;
      role: string;
      entiteFacturationId: string;
    }
  | { ok: false; code: 'siret_doublon' | 'domaine_doublon' | 'erreur' };

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
    siret,
    acceptation_cgu,
  } = body as {
    email?: string;
    mot_de_passe?: string;
    prenom?: string;
    nom?: string;
    telephone?: string;
    type_profil?: string;
    raison_sociale?: string;
    siret?: string;
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

  // Politique de mot de passe (CDC §09 l.84-85) : 10c min + maj + chiffre + spécial.
  const pwd = validatePasswordStrength(mot_de_passe);
  if (!pwd.ok) {
    return NextResponse.json({ error: pwd.error }, { status: 422 });
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

  // ── Résolution du chemin d'onboarding ──────────────────────────────────────
  // Chemin A (rattachement) : domaine pro reconnu → l'utilisateur rejoint une orga
  //   existante (qui porte déjà son entité de facturation + SIRET) → aucun SIRET à
  //   collecter ici.
  // Chemins B/C (création) : domaine pro inconnu OU domaine public → création d'une
  //   nouvelle orga + entité → SIRET requis + vérification synchrone (ONB-01).
  let attachOrganisationId: string | null = null;
  let attachRole: string | null = null;

  if (!isPublicDomain) {
    const { data: domainRow } = await supabase
      .from('organisations_domaines_email')
      .select('organisation_id, organisations(type)')
      .eq('domaine', domain)
      .maybeSingle();

    if (domainRow?.organisation_id) {
      attachOrganisationId = domainRow.organisation_id;
      const rawOrg = domainRow.organisations as
        | { type: string }
        | { type: string }[]
        | null;
      const orgType =
        (Array.isArray(rawOrg) ? rawOrg[0] : rawOrg)?.type ?? type_profil;
      attachRole = rolePourDomaineConu(orgType);
    }
  }

  const isCreationPath = attachOrganisationId === null;

  let organisationId: string;
  let userRole: string;
  let orgCreee = false; // true si l'organisation a été créée dans cette requête

  if (!isCreationPath) {
    // Chemin A — rattachement automatique à une orga existante.
    organisationId = attachOrganisationId!;
    userRole = attachRole!;
  } else {
    // Chemins B/C — création : SIRET requis + vérifié de façon synchrone.
    if (!siret || siret.trim() === '') {
      return NextResponse.json({ error: 'SIRET obligatoire' }, { status: 422 });
    }
    const siretNettoye = siret.trim();
    if (!isValidSiretFormat(siretNettoye)) {
      return NextResponse.json(
        { error: 'SIRET invalide (14 chiffres attendus)' },
        { status: 422 },
      );
    }

    // Détection de doublon SIRET (§15 §2.6 l.69) — pré-check avant l'appel INSEE.
    // L'index UNIQUE partiel uniq_entites_facturation_siret est le filet anti-race.
    const { data: doublon } = await supabase
      .from('entites_facturation')
      .select('id')
      .eq('siret', siretNettoye)
      .maybeSingle();
    if (doublon) {
      return NextResponse.json(
        { error: 'Ce SIRET est déjà rattaché à une organisation.' },
        { status: 409 },
      );
    }

    // Vérification SIRET synchrone (ONB-01) :
    //   'echec' (INSEE répond : SIRET inexistant/inactif) → 422 bloquant de saisie ;
    //   'down'  (INSEE injoignable) → en_attente + revalidation async (jamais bloquant) ;
    //   'verifie' → verifie.
    const siretResult = await verifySiret(siretNettoye);
    if (siretResult === 'echec') {
      return NextResponse.json(
        { error: 'SIRET inexistant ou entreprise inactive (INSEE).' },
        { status: 422 },
      );
    }
    const siretVerification =
      siretResult === 'verifie' ? 'verifie' : 'en_attente';

    // domain à enregistrer : seul le chemin B (domaine pro inconnu) le rattache ;
    // le chemin C (domaine public) crée une orga isolée sans rattachement.
    const domainPourRattachement = isPublicDomain ? null : domain;

    const creation = await creerNouvelleOrga(
      supabase,
      raison_sociale,
      type_profil as TypeProfil,
      domainPourRattachement,
      telephone,
      siretNettoye,
      siretVerification,
    );

    if (!creation.ok) {
      if (creation.code === 'siret_doublon') {
        return NextResponse.json(
          { error: 'Ce SIRET est déjà rattaché à une organisation.' },
          { status: 409 },
        );
      }
      if (creation.code === 'domaine_doublon') {
        return NextResponse.json(
          { error: 'Ce domaine email est déjà rattaché à une organisation.' },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: 'Erreur création organisation' },
        { status: 422 },
      );
    }

    organisationId = creation.organisationId;
    userRole = creation.role;
    orgCreee = true;

    // INSEE injoignable → planifier la revalidation (3 paliers 15min/1h/24h, ONB-02).
    if (siretResult === 'down') {
      await enqueueSiretRevalidation(
        supabase,
        creation.entiteFacturationId,
      ).catch(() => null);
    }
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
  // L'acceptation des CGU (garde plus haut) est PERSISTÉE comme preuve opposable :
  // horodatage (= création du compte, CGU Art. 11/22) + version du texte acceptée
  // (BL-P0-04). Le booléen `acceptation_cgu` n'est plus simplement jeté.
  const { error: userError } = await supabase.from('users').insert({
    id: userId,
    organisation_id: organisationId,
    email,
    prenom,
    nom,
    role: userRole,
    cgu_accepte_le: new Date().toISOString(),
    cgu_version: CGU_VERSION_COURANTE,
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
  siret: string,
  siretVerification: 'verifie' | 'en_attente',
): Promise<CreationOrgaResult> {
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

  if (error || !org) return { ok: false, code: 'erreur' };

  // Créer l'entité de facturation par défaut avec le SIRET réel + le statut de
  // vérification synchrone. Une violation de uniq_entites_facturation_siret (race
  // sur un SIRET concurrent) → doublon (409).
  const { data: entite, error: entiteErr } = await supabase
    .from('entites_facturation')
    .insert({
      organisation_id: org.id,
      raison_sociale: raisonSociale,
      siret,
      adresse_facturation: '',
      code_postal: '',
      ville: '',
      entite_par_defaut: true,
      siret_verification: siretVerification,
      siret_verifie_le:
        siretVerification === 'verifie' ? new Date().toISOString() : null,
      // Aucun n° TVA collecté au signup → non_applicable (jamais bloquant, §15 §2.6
      // l.73). Le n° TVA est renseigné/vérifié ultérieurement (Mon organisation / Admin).
      tva_verification: 'non_applicable',
    })
    .select('id')
    .single();

  if (entiteErr || !entite) {
    await rollbackOrganisation(supabase, org.id);
    if (isUniqueViolation(entiteErr)) {
      return { ok: false, code: 'siret_doublon' };
    }
    return { ok: false, code: 'erreur' };
  }

  // Enregistrer le domaine email si non-public et non-null. Une collision (race :
  // deux inscriptions concurrentes sur le même domaine inconnu) → doublon (409),
  // remplace l'ancien catch{} silencieux (ONB-03).
  if (domain) {
    const { error: domErr } = await supabase
      .from('organisations_domaines_email')
      .insert({ organisation_id: org.id, domaine: domain });
    if (domErr) {
      await rollbackOrganisation(supabase, org.id);
      if (isUniqueViolation(domErr)) {
        return { ok: false, code: 'domaine_doublon' };
      }
      return { ok: false, code: 'erreur' };
    }
  }

  return {
    ok: true,
    organisationId: org.id,
    role: rolePourDomainePropriete(typeProfil),
    entiteFacturationId: entite.id,
  };
}

// PostgreSQL 23505 = unique_violation (index UNIQUE partiel SIRET / domaine).
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
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
