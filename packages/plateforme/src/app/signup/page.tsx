'use client';

// /signup — création de compte en libre-service (CDC §05 §8 « Étape 1 —
// Inscription »). Écran PUBLIC : il était déclaré dans `PUBLIC_PREFIXES` du
// middleware mais n'existait pas — `POST /api/auth/signup` était complète et
// n'était appelée par personne, et l'URL rendait un 404.
//
// Trois étapes, pas un formulaire d'un bloc : le CDC §10 §8 impose un stepper
// au-delà de 6 champs, et il y en a 7 ici.
//
// Le SIRET n'est PAS demandé (décision Val 2026-09-23) : le CDC le classe à
// l'étape 2, « avant la première collecte ». Tant qu'il manque, la programmation
// reste bloquée et aucune facture ne part — l'inscription, elle, aboutit.

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { FormField } from '@/components/ui/form-field';
import { FormError } from '@/components/ui/form-error';
import { PASSWORD_MIN_LENGTH, validatePasswordStrength } from '@/lib/password';
import {
  isValidEmailFormat,
  isValidNomOuPrenom,
  isValidTelephoneFr,
  NOM_MIN_LENGTH,
} from '@/lib/identite-signup';

// Les 3 valeurs de `type_profil` acceptées par la route. Toute autre valeur y
// est refusée en 422 : l'écran n'en propose donc pas d'autre.
const PROFILS = [
  {
    valeur: 'traiteur',
    titre: 'Traiteur',
    detail:
      'Vous produisez les réceptions et vous programmez les collectes de vos événements.',
  },
  {
    valeur: 'agence',
    titre: 'Agence',
    detail:
      'Vous organisez des événements pour vos clients et pilotez les collectes associées.',
  },
  {
    valeur: 'gestionnaire_lieux',
    titre: 'Gestionnaire de lieux',
    detail:
      'Vous exploitez un ou plusieurs lieux et suivez ce qui y est collecté.',
  },
] as const;

type Profil = (typeof PROFILS)[number]['valeur'];

export default function SignupPage() {
  const [etape, setEtape] = useState<1 | 2 | 3>(1);
  const [envoye, setEnvoye] = useState(false);
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState('');

  const [typeProfil, setTypeProfil] = useState<Profil | ''>('');
  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');
  const [email, setEmail] = useState('');
  const [telephone, setTelephone] = useState('');
  const [raisonSociale, setRaisonSociale] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [cgu, setCgu] = useState(false);

  function allerEtape2(e: React.FormEvent) {
    e.preventDefault();
    setErreur('');
    if (!typeProfil) {
      setErreur('Choisissez le profil qui correspond à votre activité.');
      return;
    }
    setEtape(2);
  }

  function allerEtape3(e: React.FormEvent) {
    e.preventDefault();
    setErreur('');
    if (!isValidNomOuPrenom(prenom) || !isValidNomOuPrenom(nom)) {
      setErreur(`Prénom et nom : ${NOM_MIN_LENGTH} caractères minimum.`);
      return;
    }
    if (!isValidEmailFormat(email)) {
      setErreur('Saisissez une adresse email valide.');
      return;
    }
    if (!isValidTelephoneFr(telephone)) {
      setErreur(
        'Saisissez un numéro de téléphone français (ex. 01 23 45 67 89).',
      );
      return;
    }
    if (raisonSociale.trim() === '') {
      setErreur('Indiquez la raison sociale de votre entreprise.');
      return;
    }
    setEtape(3);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErreur('');

    // Tout ce qui peut être refusé sans le serveur l'est ICI : inutile de
    // consommer une des 5 tentatives horaires autorisées par adresse IP pour un
    // mot de passe trop court ou une case non cochée.
    const force = validatePasswordStrength(motDePasse);
    if (!force.ok) {
      setErreur(force.error);
      return;
    }
    if (motDePasse !== confirmation) {
      setErreur('Les deux mots de passe ne correspondent pas.');
      return;
    }
    if (!cgu) {
      setErreur(
        "Vous devez accepter les Conditions Générales d'Utilisation pour créer un compte.",
      );
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          mot_de_passe: motDePasse,
          prenom: prenom.trim(),
          nom: nom.trim(),
          telephone: telephone.trim(),
          type_profil: typeProfil,
          raison_sociale: raisonSociale.trim(),
          acceptation_cgu: cgu,
        }),
      });

      if (res.ok) {
        setEnvoye(true);
        return;
      }

      const data = (await res.json().catch(() => ({}))) as { error?: string };
      // La route décrit elle-même ses refus (422 champ invalide, 409 doublon
      // SIRET/domaine). On les montre tels quels plutôt que d'en inventer une
      // traduction qui divergerait au premier changement de la route. Le 429
      // est le seul cas où son message ne dit pas quoi faire.
      if (res.status === 429) {
        setErreur(
          'Trop de tentatives de création de compte depuis ce réseau. Réessayez dans une heure.',
        );
      } else {
        setErreur(
          data.error ?? 'Création impossible. Réessayez dans un instant.',
        );
      }
    } catch {
      setErreur('Création impossible. Vérifiez votre connexion.');
    } finally {
      setLoading(false);
    }
  }

  if (envoye) {
    return (
      <Ecran large={false}>
        <h1 className="mb-4 text-xl font-semibold text-savr-neutral-900">
          Vérifiez votre boîte mail
        </h1>
        <p className="text-sm text-savr-neutral-700">
          Votre compte est créé. Un lien d&apos;activation vient d&apos;être
          envoyé à <strong>{email.trim()}</strong>. Il est valide
          24&nbsp;heures.
        </p>
        <p className="mt-4 text-sm text-savr-neutral-500">
          Sans ce clic, la connexion reste fermée. Pensez à regarder vos
          indésirables si rien n&apos;arrive.
        </p>
        <div className="mt-6">
          <Link
            href="/login"
            className="text-sm font-semibold text-savr-primary-700 underline-offset-4 hover:underline"
          >
            Aller à la connexion
          </Link>
        </div>
      </Ecran>
    );
  }

  return (
    <Ecran large={etape === 1}>
      <h1 className="text-xl font-semibold text-savr-neutral-900">
        Créer un compte Savr
      </h1>
      <p className="mb-6 mt-1 text-sm text-savr-neutral-600">
        Étape {etape} sur 3{etape === 1 && ' — votre activité'}
        {etape === 2 && ' — vous et votre entreprise'}
        {etape === 3 && ' — mot de passe'}
      </p>

      {etape === 1 && (
        <form onSubmit={allerEtape2} className="space-y-4">
          <fieldset className="space-y-3">
            <legend className="sr-only">Type de profil</legend>
            {PROFILS.map((p) => (
              <label
                key={p.valeur}
                className={`flex cursor-pointer gap-3 rounded-savr-md border p-4 transition-colors ${
                  typeProfil === p.valeur
                    ? 'border-savr-primary-700 bg-savr-primary-50'
                    : 'border-savr-neutral-200 hover:border-savr-neutral-300'
                }`}
              >
                <input
                  type="radio"
                  name="type_profil"
                  value={p.valeur}
                  checked={typeProfil === p.valeur}
                  onChange={() => setTypeProfil(p.valeur)}
                  className="mt-1 h-4 w-4 accent-savr-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500"
                />
                <span>
                  <span className="block text-sm font-semibold text-savr-neutral-900">
                    {p.titre}
                  </span>
                  <span className="mt-0.5 block text-sm text-savr-neutral-600">
                    {p.detail}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <FormError>{erreur}</FormError>

          <Button type="submit" className="w-full">
            Continuer
          </Button>
        </form>
      )}

      {etape === 2 && (
        <form onSubmit={allerEtape3} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Prénom" htmlFor="prenom" required>
              <Input
                id="prenom"
                name="prenom"
                autoComplete="given-name"
                required
                value={prenom}
                onChange={(e) => setPrenom(e.target.value)}
              />
            </FormField>
            <FormField label="Nom" htmlFor="nom" required>
              <Input
                id="nom"
                name="nom"
                autoComplete="family-name"
                required
                value={nom}
                onChange={(e) => setNom(e.target.value)}
              />
            </FormField>
          </div>

          <FormField
            label="Email professionnel"
            htmlFor="email"
            required
            hint="Il sert d'identifiant. Une adresse au domaine de votre entreprise vous rattache automatiquement à son compte."
          >
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormField>

          <FormField label="Téléphone" htmlFor="telephone" required>
            <Input
              id="telephone"
              name="telephone"
              type="tel"
              autoComplete="tel"
              required
              value={telephone}
              onChange={(e) => setTelephone(e.target.value)}
            />
          </FormField>

          <FormField label="Raison sociale" htmlFor="raison-sociale" required>
            <Input
              id="raison-sociale"
              name="raison_sociale"
              autoComplete="organization"
              required
              value={raisonSociale}
              onChange={(e) => setRaisonSociale(e.target.value)}
            />
          </FormField>

          <FormError>{erreur}</FormError>

          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => {
                setErreur('');
                setEtape(1);
              }}
            >
              Retour
            </Button>
            <Button type="submit" className="w-full">
              Continuer
            </Button>
          </div>
        </form>
      )}

      {etape === 3 && (
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <p className="text-sm text-savr-neutral-600">
            Au moins {PASSWORD_MIN_LENGTH} caractères, avec une majuscule, un
            chiffre et un caractère spécial.
          </p>

          <FormField label="Mot de passe" htmlFor="mot-de-passe" required>
            <Input
              id="mot-de-passe"
              name="mot-de-passe"
              type="password"
              autoComplete="new-password"
              required
              value={motDePasse}
              error={!!erreur}
              onChange={(e) => setMotDePasse(e.target.value)}
            />
          </FormField>

          <FormField label="Confirmation" htmlFor="confirmation" required>
            <Input
              id="confirmation"
              name="confirmation"
              type="password"
              autoComplete="new-password"
              required
              value={confirmation}
              error={!!erreur}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </FormField>

          <div className="flex items-start gap-3 pt-2">
            <Checkbox
              id="cgu"
              checked={cgu}
              onCheckedChange={(v) => setCgu(v === true)}
              aria-describedby="cgu-label"
            />
            <label
              id="cgu-label"
              htmlFor="cgu"
              className="cursor-pointer text-sm text-savr-neutral-700"
            >
              J&apos;accepte les{' '}
              <Link
                href="/cgu"
                target="_blank"
                className="font-semibold text-savr-primary-700 underline-offset-4 hover:underline"
              >
                Conditions Générales d&apos;Utilisation
              </Link>
              . Cette acceptation est horodatée et conservée.
            </label>
          </div>

          <FormError>{erreur}</FormError>

          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => {
                setErreur('');
                setEtape(2);
              }}
            >
              Retour
            </Button>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Création…' : 'Créer mon compte'}
            </Button>
          </div>
        </form>
      )}

      <div className="mt-6 border-t border-savr-neutral-200 pt-4 text-sm">
        <Link
          href="/login"
          className="font-semibold text-savr-primary-700 underline-offset-4 hover:underline"
        >
          J&apos;ai déjà un compte
        </Link>
      </div>
    </Ecran>
  );
}

function Ecran({
  children,
  large,
}: {
  children: React.ReactNode;
  large: boolean;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-savr-neutral-50 px-4 py-10">
      <div
        className={`w-full rounded-savr-lg border border-savr-neutral-200 bg-savr-white p-8 shadow-sm ${
          large ? 'max-w-lg' : 'max-w-md'
        }`}
      >
        {children}
      </div>
    </div>
  );
}
