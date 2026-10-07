// Point d'entrée du bundle du design system Claude Design (window.SavrDS).
// Tout ce qui est exporté ici devient une brique disponible dans les aperçus.
// Exclus : impersonation-banner-mount et impersonation-launcher (Supabase).
export * from '@/components/ui/accordion';
export * from '@/components/ui/alert-bar';
export * from '@/components/ui/autocomplete';
export * from '@/components/ui/badge';
export * from '@/components/ui/breadcrumb';
export * from '@/components/ui/button';
export * from '@/components/ui/calendar';
export * from '@/components/ui/card';
export * from '@/components/ui/checkbox';
export * from '@/components/ui/collecte-statut-badge';
export * from '@/components/ui/combobox';
export * from '@/components/ui/command';
export * from '@/components/ui/data-grid';
export * from '@/components/ui/data-table';
export * from '@/components/ui/date-picker';
export * from '@/components/ui/date-range-picker';
export * from '@/components/ui/dropdown';
export * from '@/components/ui/empty-state';
export * from '@/components/ui/filter-bar';
export * from '@/components/ui/filter-chips';
export * from '@/components/ui/filtre-en-ligne';
export * from '@/components/ui/form-error';
export * from '@/components/ui/form-field';
export * from '@/components/ui/icon-button';
export * from '@/components/ui/impersonation-banner';
export * from '@/components/ui/input';
export * from '@/components/ui/label';
export * from '@/components/ui/modal';
export * from '@/components/ui/ops-read-only-banner';
export * from '@/components/ui/pack-ag-indicator';
export * from '@/components/ui/page-hero';
export * from '@/components/ui/pagination';
export * from '@/components/ui/popover';
export * from '@/components/ui/sheet';
export * from '@/components/ui/skeleton';
export * from '@/components/ui/stat-card';
export * from '@/components/ui/status-collecte';
export * from '@/components/ui/switch';
export * from '@/components/ui/table';
export * from '@/components/ui/tabs';
export * from '@/components/ui/textarea';
export * from '@/components/ui/time-picker';
export * from '@/components/ui/timeline';
export * from '@/components/ui/toast';
export * from '@/components/ui/toggle-group';
export * from '@/components/ui/tooltip';
export * from '@/components/ui/tournee-card';
export * from '@/components/ui/actif-badge';
export * from '@/components/ui/chart-tooltip';
export * from '@/components/ui/confirm-dialog';
export * from '@/components/ui/error-state';
export * from '@/components/ui/facture-statut-badge';
export * from '@/components/ui/fiche/fiche-en-tete';
export * from '@/components/ui/fiche/fiche-modal';
export * from '@/components/ui/fiche/onglet-avec-erreurs';
export * from '@/components/ui/form-actions';
export * from '@/components/ui/form-grid';
export * from '@/components/ui/heading';
export * from '@/components/ui/info-item';
export * from '@/components/ui/list-footer';
export * from '@/components/ui/loading-state';
export * from '@/components/ui/page-header';
export * from '@/components/ui/radio-group';
export * from '@/components/ui/section-header';
export * from '@/components/ui/sparkline';
export * from '@/components/ui/text';
export * from '@/components/ui/text-link';
export * from '@/components/ui/toggle-chip';
export * from '@/components/ui/type-collecte-badge';
// Composants métier réutilisés par plusieurs écrans.
export { SavrLogoMark } from '@/components/layout/savr-logo';
export { ChartCard } from '@/components/dashboards/charts/cockpit/ChartCard';
export { TopRankList } from '@/components/dashboards/charts/cockpit/TopRankList';
export { ContactLigne, TelephoneLien } from '@/components/collecte/fiche-blocs';
export { ToggleTypeCollecte } from '@/components/collecte/toggle-type-collecte';
export { CollecteStatutFrise } from '@/components/admin/collecte-statut-frise';
export { FriseStatutClient } from '@/components/collecte/frise-statut-client';
export { FriseEtapes } from '@/components/collecte/frise-etapes';
export { CollecteFiltreActif } from '@/components/collecte/collecte-filtre-actif';
export { AuthCard, AuthPage } from '@/components/auth/auth-card';
export { EmptyDashboardState } from '@/components/dashboards/EmptyDashboardState';
export { DashboardFilterBar } from '@/components/dashboards/DashboardFilterBar';
export { ParcMultiSelects } from '@/components/dashboards/ParcMultiSelects';
export { cn } from '@/lib/utils';
// Icônes lucide utilisées par les aperçus (sous-ensemble : la bibliothèque entière pèserait ~1,5 Mo).
export {
  AlertTriangle,
  ArrowRight,
  Building2,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Filter,
  HandHeart,
  Inbox,
  Info,
  Leaf,
  Loader2,
  Mail,
  MapPin,
  MoreHorizontal,
  Package,
  Pencil,
  Phone,
  Plus,
  Recycle,
  Scale,
  Search,
  Settings,
  Trash2,
  Truck,
  User,
  UtensilsCrossed,
  X,
} from 'lucide-react';
