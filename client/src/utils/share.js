import { getToken, ApiError } from '../api/client';
import { pdfBlobToPngBlob } from './pdfToImage';

async function fetchAuthedBlob(path) {
  const token = getToken();
  const response = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new ApiError(`Download failed (${response.status})`, response.status);
  return response.blob();
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Fetches a server-generated PDF and either downloads it as-is, or renders it
// to a PNG client-side (no server-side image conversion / native deps) — then
// tries the OS share sheet (Web Share API) if the platform supports sharing
// files, falling back to a plain download otherwise.
export async function shareDocument(path, filenameBase, format = 'pdf') {
  const pdfBlob = await fetchAuthedBlob(path);
  const isImage = format === 'image';
  const blob = isImage ? await pdfBlobToPngBlob(pdfBlob) : pdfBlob;
  const filename = `${filenameBase}.${isImage ? 'png' : 'pdf'}`;
  const file = new File([blob], filename, { type: blob.type });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filenameBase });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // user cancelled the share sheet
      // Any other share failure: fall through to a plain download instead.
    }
  }
  triggerDownload(blob, filename);
}
