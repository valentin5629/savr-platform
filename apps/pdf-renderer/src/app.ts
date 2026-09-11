import { randomUUID } from 'node:crypto';
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { requireInternalToken } from './auth.js';
import { renderByType, UnknownDocumentTypeError } from './render.js';

export type RenderPdf = (html: string) => Promise<Uint8Array>;

export async function renderWithChromium(html: string): Promise<Uint8Array> {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
  } finally {
    await browser.close();
  }
}

/**
 * Erreur interne : le détail reste dans les logs Railway, la réponse ne porte
 * qu'un code court + une référence. Le worker Plateforme recopie le corps dans
 * jobs_pdf.last_error (« Railway PDF 500: {"error":"render_error","ref":…} ») :
 * le code dit quelle étape a cassé, `ref` retrouve la trace dans les logs.
 */
function failWith(
  res: Response,
  status: number,
  code: string,
  err: unknown,
  context: Record<string, unknown> = {},
): void {
  const ref = randomUUID();
  console.error(`[${code}] ref=${ref}`, context, err);
  res.status(status).json({ error: code, ref });
}

export function createApp(
  secret: string | undefined,
  renderPdf: RenderPdf = renderWithChromium,
): Express {
  const app = express();
  app.disable('x-powered-by');
  // Aucune route ne lit req.query : pas de parsing qs (surface inutile avant l'auth).
  app.set('query parser', false);

  // Sonde Railway : seule route exemptée, GET/HEAD uniquement, déclarée avant
  // l'auth (un POST /health retombe sur l'auth → 401).
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // Auth AVANT le parsing JSON : un appelant non authentifié ne fait pas lire
  // son corps (2 Mo max) et reçoit 401, jamais une erreur de parsing.
  app.use(requireInternalToken(secret));
  app.use(express.json({ limit: '2mb' }));

  app.post('/generate-pdf', async (req: Request, res: Response) => {
    const { type, data } = (req.body ?? {}) as { type: string; data: unknown };

    let html: string;
    try {
      html = renderByType(type, data);
    } catch (err) {
      if (err instanceof UnknownDocumentTypeError) {
        res.status(400).json({ error: err.message });
        return;
      }
      failWith(res, 422, 'template_error', err, { type });
      return;
    }

    try {
      const pdf = await renderPdf(html);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Length': pdf.length,
      });
      res.send(Buffer.from(pdf));
    } catch (err) {
      failWith(res, 500, 'render_error', err, { type });
    }
  });

  // Erreurs levées par express.json (JSON invalide, corps > 2 Mo) : pas de page
  // d'erreur HTML ni de stack, un code court.
  app.use(
    (
      err: { status?: number; type?: string },
      _req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      if (res.headersSent) return next(err);
      const status =
        typeof err.status === 'number' && err.status >= 400 && err.status < 500
          ? err.status
          : 500;
      if (status === 500) {
        failWith(res, 500, 'internal_error', err);
        return;
      }
      res.status(status).json({ error: 'bad_request' });
    },
  );

  return app;
}
