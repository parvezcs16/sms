// Prints one element (with the <style> it carries) through the browser's own
// print dialog — the browser shapes Urdu perfectly, and "Save as PDF" is
// offered there too. Used for exam paper previews.
export function printElement(el, title = 'Print', { page = 'A4', margin = '14mm' } = {}) {
  if (!el) return;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title>
    <style>@page { size: ${page}; margin: ${margin}; } body { margin: 0; background: #fff; color: #000; }</style></head>
    <body>${el.outerHTML}</body></html>`);
  doc.close();
  const go = () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } finally {
      setTimeout(() => iframe.remove(), 1500);
    }
  };
  const imgs = Array.from(doc.images || []);
  if (!imgs.length) { setTimeout(go, 150); return; }
  let left = imgs.length;
  const done = () => { left -= 1; if (left <= 0) setTimeout(go, 100); };
  imgs.forEach((img) => (img.complete ? done() : (img.onload = img.onerror = done)));
}
