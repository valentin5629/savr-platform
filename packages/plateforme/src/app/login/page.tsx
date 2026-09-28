'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { safeNextPath } from '@/lib/safe-next-path';
import { AlertBar } from '@/components/ui/alert-bar';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';

// Motifs posés par `api/auth/verify-email` quand le lien d'activation n'aboutit
// pas. Ils arrivaient déjà en `?error=` mais n'étaient affichés nulle part :
// l'utilisateur voyait un écran de connexion muet (revue go-live 2026-09-23).
//
// ⚠ `Map` et non objet littéral : un objet rend AUSSI les clés héritées
// d'`Object.prototype`. Avec un objet, `/login?error=__proto__` rendait un objet
// là où React attend du texte et FAISAIT PLANTER la page de connexion — par
// simple lien forgé, et sans `error.tsx` pour amortir. `toString`, `valueOf` &
// consorts rendaient une fonction ou passaient en silence. Un `Map` n'a pas de
// clés héritées : seul ce qui est posé ici peut sortir.
const MESSAGES_ERREUR = new Map<string, string>([
  [
    'lien_invalide',
    "Ce lien de vérification est incomplet ou a déjà servi. Écrivez-nous à hello@gosavr.io si vous n'arrivez pas à activer votre compte.",
  ],
  [
    'verification_echouee',
    "Ce lien de vérification a expiré ou a déjà été utilisé. Écrivez-nous à hello@gosavr.io pour recevoir un nouveau lien d'activation.",
  ],
  // ── Motifs renvoyés par Supabase dans le FRAGMENT (#error_code=…) ──────────
  // Un fragment n'est JAMAIS transmis au serveur : ni le middleware ni une route
  // ne peuvent le voir. Quand Supabase refuse un lien d'email, il redirige vers
  // le Site URL du projet — donc ici, via le middleware — en plaçant le motif
  // là. Sans la lecture ci-dessous, l'utilisateur tombait sur un formulaire de
  // connexion parfaitement muet (panne mesurée en dev le 2026-09-24 : le seul
  // indice était `#error_code=otp_expired` dans la barre d'adresse).
  [
    'otp_expired',
    "Ce lien a expiré ou a déjà servi — il ne fonctionne qu'une fois. Demandez-en un nouveau ci-dessous.",
  ],
  [
    'access_denied',
    "Ce lien n'a pas pu être vérifié. Demandez-en un nouveau ci-dessous.",
  ],
]);

/**
 * Motif d'erreur placé par Supabase dans le fragment de l'URL.
 *
 * `window.location.hash` n'existe pas au rendu serveur : on lit après montage,
 * d'où l'état plutôt qu'un calcul direct. `URLSearchParams` accepte la forme
 * `a=1&b=2` une fois le `#` retiré.
 */
function useMotifFragment(): string | undefined {
  const [motif, setMotif] = useState<string | undefined>(undefined);
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '');
    if (hash === '') return;
    const params = new URLSearchParams(hash);
    // `error_code` est le plus précis ; `error` est le repli générique.
    const code = params.get('error_code') ?? params.get('error') ?? '';
    setMotif(MESSAGES_ERREUR.get(code));
  }, []);
  return motif;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // `?error=` : motif d'un lien d'activation qui n'a pas abouti. Lu dans une
  // table fermée — un motif inconnu (URL forgée) n'affiche rien plutôt que
  // d'imprimer le paramètre tel quel.
  const messageQuery = MESSAGES_ERREUR.get(searchParams.get('error') ?? '');
  const messageFragment = useMotifFragment();
  const messageLien = messageQuery ?? messageFragment;
  // Pas de `next` (login direct) → `/` qui redirige vers l'espace du rôle
  // (page.tsx / HOME_BY_ROLE). Surtout pas `/admin/dashboard` en dur, sinon
  // tous les rôles atterrissent sur le back-office Admin. Validé : un `next`
  // externe (lien forgé) retombe sur `/` (open redirect, cf. safeNextPath).
  const next = safeNextPath(searchParams.get('next'));

  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErreur('');

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, mot_de_passe: motDePasse }),
    });

    if (res.ok) {
      router.push(next);
      router.refresh();
    } else {
      const data = (await res.json()) as { error?: string };
      setErreur(data.error ?? 'Identifiants incorrects');
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          {/* h1 de la page : style CardTitle (DS §5.2 titre de card, poids 600) — CardTitle rend un h3. */}
          <h1 className="text-lg font-semibold tracking-tight text-savr-neutral-900">
            Connexion à votre compte
          </h1>
          <CardDescription>
            Saisissez votre email pour vous connecter à Savr.
          </CardDescription>
        </div>
        {/* Sans ce lien, /signup n'était atteignable qu'en tapant l'URL. */}
        <Link
          href="/signup"
          className="-my-3 inline-flex shrink-0 items-center py-3 text-sm font-semibold text-savr-primary-700 underline-offset-4 hover:underline"
        >
          Créer un compte
        </Link>
      </CardHeader>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <CardContent className="space-y-4">
          {messageLien && (
            <AlertBar variant="warn" className="font-normal">
              {messageLien}
            </AlertBar>
          )}
          <FormField label="Email" htmlFor="login-email">
            <Input
              id="login-email"
              type="email"
              required
              autoComplete="email"
              placeholder="nom@entreprise.fr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormField>
          <div className="space-y-1">
            <div className="mb-1.5 flex items-center justify-between gap-4">
              <Label htmlFor="login-mot-de-passe" className="mb-0">
                Mot de passe
              </Label>
              <Link
                href="/reset-password"
                className="-my-3 inline-flex items-center py-3 text-sm text-savr-neutral-700 underline-offset-4 hover:text-savr-primary-700 hover:underline"
              >
                Mot de passe oublié ?
              </Link>
            </div>
            <Input
              id="login-mot-de-passe"
              type="password"
              required
              autoComplete="current-password"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
            />
          </div>
          {erreur && <p className="text-sm text-savr-error">{erreur}</p>}
        </CardContent>
        <CardFooter className="rounded-b-savr-md bg-savr-neutral-50 pt-6">
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Connexion…' : 'Se connecter'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-savr-neutral-50 px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
