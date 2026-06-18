import { requireStaffPage } from '@/lib/page-auth';
import { DashboardClientView } from './DashboardClientView.js';

// §06.06 §2 — Dashboard Client : vue Admin LECTURE SEULE répliquant les
// dashboards clients (§06.05) avec sélecteur d'organisations.
// Accès : admin_savr + ops_savr (garde middleware + garde serveur défensive).
export default async function DashboardClientPage() {
  await requireStaffPage();
  return <DashboardClientView />;
}
