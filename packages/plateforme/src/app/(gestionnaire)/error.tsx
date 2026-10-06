'use client';

import { RouteError } from '@/components/layout/route-states';

// Erreur de route (R-UI-1 H5) : rendue sous le layout du groupe, message
// générique + « Réessayer » (`reset`). Une erreur du layout lui-même remonte
// au `global-error.tsx`.
export default RouteError;
