'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Paramètres = redirection vers mon-organisation (onglet profil)
export default function ParametresPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/gestionnaire/mon-organisation');
  }, [router]);

  return <p className="text-sm text-savr-neutral-500">Redirection…</p>;
}
