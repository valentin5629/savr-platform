import type { Metadata } from 'next';
import { Nunito } from 'next/font/google';
import './globals.css';
import { ImpersonationBannerMount } from '@/components/ui/impersonation-banner-mount';
import { ToastProvider } from '@/components/ui/toast';

const nunito = Nunito({
  subsets: ['latin'],
  variable: '--font-nunito',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
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
    <html lang="fr" className={nunito.variable}>
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
