const { BrowserWindow } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { print: printWithSumatra } = require('pdf-to-printer');

// Tamano de tarjeta CR-80 (85.60mm x 54.00mm) en pulgadas — printToPDF con pageSize
// custom en micrones produce PDFs en blanco en esta versión de Electron (confirmado
// empíricamente); pulgadas es la unidad que sí funciona.
const CARD_PAGE_SIZE = { width: 85.6 / 25.4, height: 54 / 25.4 };

let utilityWindow = null;

function getUtilityWindow() {
  if (!utilityWindow || utilityWindow.isDestroyed()) {
    utilityWindow = new BrowserWindow({ show: false });
  }
  return utilityWindow;
}

async function listPrinters() {
  const win = getUtilityWindow();
  return win.webContents.getPrintersAsync();
}

function toFileUrl(src) {
  if (src.startsWith('data:') || src.startsWith('file://') || src.startsWith('http')) {
    return src;
  }
  return 'file://' + path.resolve(src);
}

function buildCardHtml({ frontImage, backImage }) {
  const frontSrc = toFileUrl(frontImage);
  const backSrc = toFileUrl(backImage);
  return `<!DOCTYPE html>
<html><head><style>
  @page { margin: 0; }
  * {
    margin: 0;
    padding: 0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  /* El diseño de la credencial (frontal.jpeg/posterior.jpeg en el generador
     Rails) está armado en vertical (1024x1600), pero la tarjeta física CR-80
     es horizontal (85.6mm x 54mm). Se rota la imagen 90° dentro del marco
     horizontal en vez de recortarla — así se ve completa y correctamente
     orientada en la tarjeta impresa. */
  .card { width: 85.6mm; height: 54mm; overflow: hidden; position: relative; page-break-after: always; }
  .card:last-child { page-break-after: auto; }
  .card img {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 54mm;
    height: 85.6mm;
    object-fit: cover;
    display: block;
  }
  /* El reverso (posterior.jpeg) tiene el "arriba" del diseño invertido
     respecto al frente (queda boca abajo al voltear la tarjeta), así que
     necesita 180° extra sobre la misma rotación de -90° del frente. */
  .card--front img { transform: translate(-50%, -50%) rotate(-90deg); }
  .card--back img { transform: translate(-50%, -50%) rotate(90deg); }
</style></head>
<body>
  <div class="card card--front"><img src="${frontSrc}"></div>
  <div class="card card--back"><img src="${backSrc}"></div>
</body></html>`;
}

async function renderCardPdf(job) {
  const html = buildCardHtml(job);
  // Se escribe a un archivo file:// real (en vez de data:) porque Chromium bloquea
  // que un documento data: cargue imágenes file:// locales (distinto origen) — con
  // loadFile ambos quedan bajo el mismo origen file:// y las imágenes sí cargan.
  const tmpHtmlPath = path.join(os.tmpdir(), `credencial-${Date.now()}-${process.pid}.html`);
  fs.writeFileSync(tmpHtmlPath, html);
  const win = new BrowserWindow({ show: false });
  try {
    await win.loadFile(tmpHtmlPath);
    const pdfBuffer = await win.webContents.printToPDF({
      pageSize: CARD_PAGE_SIZE,
      margins: { marginType: 'none' },
      printBackground: true,
    });
    const tmpPdfPath = path.join(os.tmpdir(), `credencial-${Date.now()}-${process.pid}.pdf`);
    fs.writeFileSync(tmpPdfPath, pdfBuffer);
    return tmpPdfPath;
  } finally {
    win.destroy();
    fs.unlink(tmpHtmlPath, () => {});
  }
}

function printPdfMac(pdfPath, config) {
  return new Promise((resolve, reject) => {
    if (!config.printerName) {
      return reject(new Error('No hay impresora configurada. Elígela desde el menú de la bandeja.'));
    }
    const args = ['-d', config.printerName, '-o', 'PageSize=CR80', '-o', 'DualSidePrinting=true'];
    if (config.copies && config.copies > 1) {
      args.push('-n', String(config.copies));
    }
    if (config.ribbonCombination) {
      args.push('-o', `RibbonCombination=${config.ribbonCombination}`);
    }
    args.push(pdfPath);
    execFile('lp', args, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

// Windows no tiene CUPS/`lp` — se imprime vía pdf-to-printer, que trae SumatraPDF
// empaquetado y lo invoca en modo silencioso. SumatraPDF sí puede activar el
// dúplex estándar de Windows (dmDuplex del DEVMODE del driver), pero NO tiene
// forma de mandar la opción RibbonCombination del driver Zebra (esa es una
// extensión propia del PPD, sin equivalente en la API de impresión de Windows).
// En Windows, la combinación de cinta debe configurarse una sola vez desde las
// Preferencias de impresión del driver Zebra (Panel de control > Dispositivos e
// impresoras), no por job como en Mac. Pendiente de validar en hardware real
// (ver NOTES.md).
function printPdfWindows(pdfPath, config) {
  if (!config.printerName) {
    return Promise.reject(new Error('No hay impresora configurada. Elígela desde el menú de la bandeja.'));
  }
  const printOptions = { printer: config.printerName, side: 'duplex' };
  if (config.copies && config.copies > 1) {
    printOptions.copies = config.copies;
  }
  return printWithSumatra(pdfPath, printOptions).then(() => 'ok');
}

async function printJob(job, config) {
  const mergedConfig = {
    ...config,
    printerName: job.printerName || config.printerName,
    ribbonCombination: job.ribbonCombination || config.ribbonCombination,
    copies: job.copies,
  };

  let pdfPath = job.pdfPath;
  let cleanup = false;
  if (!pdfPath) {
    if (!job.frontImage || !job.backImage) {
      throw new Error('El job debe traer pdfPath, o frontImage + backImage.');
    }
    pdfPath = await renderCardPdf(job);
    cleanup = true;
  }

  try {
    if (process.platform === 'darwin') {
      return await printPdfMac(pdfPath, mergedConfig);
    }
    if (process.platform === 'win32') {
      return await printPdfWindows(pdfPath, mergedConfig);
    }
    throw new Error(`Plataforma no soportada: ${process.platform}`);
  } finally {
    if (cleanup) fs.unlink(pdfPath, () => {});
  }
}

module.exports = { listPrinters, printJob, renderCardPdf, CARD_PAGE_SIZE };
