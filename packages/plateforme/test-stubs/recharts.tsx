/**
 * Stub recharts pour vitest (aliasé dans vitest.config.ts) — UNIQUEMENT en test.
 * Le vrai recharts monte un ResponsiveContainer + ResizeObserver qui laisse des
 * handles ouverts sous jsdom → vitest ne se termine jamais (hang CI). Le build
 * Next.js et le GO-VISUAL utilisent le vrai recharts ; seuls les tests unitaires
 * (qui vérifient la légende / le résumé DOM rendus HORS recharts) voient ce stub.
 */
import * as React from 'react';

type P = { children?: React.ReactNode };
const Pass = ({ children }: P) =>
  React.createElement(React.Fragment, null, children);
const Leaf = () => null;

export const ResponsiveContainer = Pass;
export const ComposedChart = Pass;
export const PieChart = Pass;
export const Pie = Pass;
export const Bar = Leaf;
export const Line = Leaf;
export const Cell = Leaf;
export const XAxis = Leaf;
export const YAxis = Leaf;
export const CartesianGrid = Leaf;
export const Tooltip = Leaf;
export const Legend = Leaf;
export const Area = Leaf;
export const AreaChart = Pass;
export const BarChart = Pass;
export const LineChart = Pass;
export const ReferenceLine = Leaf;

export default { ResponsiveContainer, ComposedChart, PieChart };
