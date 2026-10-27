import type { Metadata } from 'next';
import { Archivo, Inter } from 'next/font/google';
import './globals.css';
import { ImpersonationBannerMount } from '@/components/ui/impersonation-banner-mount';
import { ToastProvider } from '@/components/ui/toast';

// Texte en Inter, titres et grands chiffres en Archivo (décision Val
// 2026-10-27, refonte de la fiche collecte étendue à toute la plateforme).
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});
const archivo = Archivo({
  subsets: ['latin'],
  variable: '--font-archivo',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Savr Plateforme',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" className={`${inter.variable} ${archivo.variable}`}>
      <body>
        {/* Toast monté une fois pour toute l'app (§10 §7 « Success = Toast
            4 s », R-UI-1 H1). */}
        <ToastProvider>
          <ImpersonationBannerMount />
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
