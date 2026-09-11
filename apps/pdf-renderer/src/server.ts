import { createApp } from './app.js';

const app = createApp(process.env['RAILWAY_PDF_SECRET']);

const port = parseInt(process.env['PORT'] ?? '3001', 10);
app.listen(port, () => {
  console.log(`pdf-renderer démarré sur :${port}`);
});
