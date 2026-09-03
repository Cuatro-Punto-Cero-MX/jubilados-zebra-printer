const express = require('express');
const fs = require('fs');
const { printJob, listPrinters, renderCardPdf } = require('./printEngine');
const { log } = require('./logger');

// El navegador manda las imágenes como data: URI en base64 (cientos de KB cada
// una). Para el log solo interesa el tipo y el tamaño, no el contenido.
function describeSource(src) {
  if (typeof src !== 'string') return src;
  if (src.startsWith('data:')) {
    const comma = src.indexOf(',');
    const meta = comma === -1 ? src.slice(0, 40) : src.slice(0, comma);
    return `<${meta}, ${src.length} chars>`;
  }
  return src; // ruta de archivo o URL — corto, se deja tal cual
}

function startServer(config) {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  // El agente solo escucha en 127.0.0.1, pero quien lo llama es JS corriendo en
  // el navegador (página de Rails en otro origen, ej. http://localhost:3000 o
  // el dominio real en producción) — sin estos headers el navegador bloquea el
  // fetch() cross-origin antes de que llegue aquí.
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/health', async (req, res) => {
    res.json({ ok: true, printer: config.printerName, platform: process.platform });
  });

  app.get('/printers', async (req, res) => {
    try {
      const printers = await listPrinters();
      res.json({ ok: true, printers });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/preview', async (req, res) => {
    try {
      const pdfPath = await renderCardPdf(req.body);
      res.setHeader('Content-Type', 'application/pdf');
      fs.createReadStream(pdfPath).pipe(res).on('close', () => fs.unlink(pdfPath, () => {}));
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/print', async (req, res) => {
    const jobSummary = req.body.pdfPath
      ? { pdfPath: req.body.pdfPath }
      : { frontImage: describeSource(req.body.frontImage), backImage: describeSource(req.body.backImage) };
    try {
      const result = await printJob(req.body, config);
      log(`OK /print ${JSON.stringify(jobSummary)} -> ${result}`);
      res.json({ ok: true, result });
    } catch (err) {
      log(`ERROR /print ${JSON.stringify(jobSummary)} -> ${err.message}`);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  const server = app.listen(config.port, '127.0.0.1', () => {
    log(`API local escuchando en http://127.0.0.1:${config.port}`);
  });
  server.on('error', (err) => {
    log(`ERROR arrancando servidor en puerto ${config.port}: ${err.message}`);
  });
  return server;
}

module.exports = { startServer };
