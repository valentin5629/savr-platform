'use client';

// Carte affichée quand le lien d'invitation ne peut pas servir : chaque cas dit
// ce qui se passe et propose la suite utile, jamais une impasse.

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { AlertBar } from '@/components/ui/alert-bar';
import { AuthCard, AuthPage } from '@/components/auth/auth-card';
import { ROUTES } from '@/lib/routes';

type Motif = 'invalide' | 'expire' | 'utilise' | 'inactif';

const CONTENU: Record<
  Motif,
  { titre: string; texte: string; bouton: string; lien: string }
> = {
  expire: {
    titre: 'Lien expiré',
    texte:
      "Ce lien d'invitation était valable 7 jours. Votre compte existe toujours : recevez un lien d'accès par email pour choisir votre mot de passe, ou demandez à la personne qui vous a invité de renouveler l'invitation.",
    bouton: "Recevoir un lien d'accès",
    lien: ROUTES.resetPassword,
  },
  utilise: {
    titre: 'Lien déjà utilisé',
    texte:
      "Ce lien d'invitation a déjà servi, ou une nouvelle invitation vous a été envoyée depuis. Si votre mot de passe est choisi, connectez-vous ; sinon, utilisez le lien de la dernière invitation reçue.",
    bouton: 'Se connecter',
    lien: ROUTES.login,
  },
  invalide: {
    titre: 'Lien incomplet',
    texte:
      "Ce lien d'invitation n'est pas valable. Ouvrez-le directement depuis l'email reçu : copié à la main, il est souvent tronqué.",
    bouton: 'Aller à la connexion',
    lien: ROUTES.login,
  },
  inactif: {
    titre: 'Compte inactif',
    texte:
      "Ce compte a été désactivé depuis l'invitation. Rapprochez-vous de votre organisation, ou écrivez-nous à contact@gosavr.io.",
    bouton: 'Aller à la connexion',
    lien: ROUTES.login,
  },
};

export function CarteLienInvitation({ motif }: { motif: Motif }) {
  const c = CONTENU[motif];
  return (
    <AuthPage>
      <AuthCard
        titre={c.titre}
        pied={
          <Button asChild className="w-full">
            <Link href={c.lien}>{c.bouton}</Link>
          </Button>
        }
      >
        <AlertBar variant="warn" className="font-normal">
          {c.texte}
        </AlertBar>
      </AuthCard>
    </AuthPage>
  );
}
