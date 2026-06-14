import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import {
  renderBordereauZd,
  type BordereauZdData,
} from './templates/bordereau-zd.js';
import {
  renderRapportRecyclageZd,
  type RapportRecyclageZdData,
} from './templates/rapport-recyclage-zd.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

const INTERNAL_TOKEN = process.env['RAILWAY_PDF_SECRET'];

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/health') return next();
  const token = req.headers['x-internal-token'];
  if (!INTERNAL_TOKEN || token !== INTERNAL_TOKEN) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.post('/generate-pdf', async (req: Request, res: Response) => {
  const { type, data } = req.body as { type: string; data: unknown };

  let html: string;
  try {
    if (type === 'bordereau-zd') {
      html = renderBordereauZd(data as BordereauZdData);
    } else if (type === 'rapport-recyclage-zd') {
      html = renderRapportRecyclageZd(data as RapportRecyclageZdData);
    } else {
      res.status(400).json({ error: `Type inconnu : ${type}` });
      return;
    }
  } catch (err) {
    res.status(422).json({ error: `Erreur template : ${String(err)}` });
    return;
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: true,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': pdf.length,
    });
    res.send(Buffer.from(pdf));
  } catch (err) {
    console.error('Erreur Puppeteer :', err);
    res.status(500).json({ error: `Erreur génération PDF : ${String(err)}` });
  } finally {
    if (browser) await browser.close();
  }
});

const port = parseInt(process.env['PORT'] ?? '3001', 10);
app.listen(port, () => {
  console.log(`pdf-renderer démarré sur :${port}`);
});
