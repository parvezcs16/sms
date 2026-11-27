// Renders page 1 of a PDF (fetched as a Blob) to a PNG image, entirely in the
// browser — no server-side conversion, no native image libraries. pdfjs-dist
// draws onto a normal <canvas>, which every browser/Electron renderer provides
// natively, so this stays dependency-light on the backend.
//
// Dynamically imported so pdfjs-dist (a couple MB) is only fetched the first
// time someone actually clicks "Image", not on every page load — this bundle
// is also served to the mobile attendance page over Wi-Fi, where it matters.
let pdfjsLibPromise;
function loadPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = Promise.all([
      import('pdfjs-dist/build/pdf.mjs'),
      // eslint-disable-next-line import/no-unresolved
      import('pdfjs-dist/build/pdf.worker.mjs?url')
    ]).then(([pdfjsLib, workerUrlModule]) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrlModule.default;
      return pdfjsLib;
    });
  }
  return pdfjsLibPromise;
}

export async function pdfBlobToPngBlob(pdfBlob, { scale = 2 } = {}) {
  const pdfjsLib = await loadPdfjs();
  const arrayBuffer = await pdfBlob.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport }).promise;
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
