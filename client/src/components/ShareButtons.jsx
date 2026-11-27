import { useState } from 'react';
import { shareDocument } from '../utils/share';
import { useToast } from '../context/ToastContext';
import IconButton from './IconButton';

// Two small buttons that fetch a server-generated PDF and either share/download
// it as-is, or convert it to a PNG first (client-side, via pdfjs-dist) — used
// anywhere a document (voucher, receipt, payslip, notice, exam paper) can be
// shared as either format.
export default function ShareButtons({ path, filenameBase, size = 'btn-sm', iconOnly = false }) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);

  async function handle(format) {
    setBusy(format);
    try {
      await shareDocument(path, filenameBase, format);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }

  if (iconOnly) {
    return (
      <>
        <IconButton icon="pdf" label="PDF — download / share" busy={busy === 'pdf'} onClick={() => handle('pdf')} />
        <IconButton icon="image" label="Image — download / share as picture" busy={busy === 'image'} onClick={() => handle('image')} />
      </>
    );
  }

  return (
    <>
      <button type="button" className={`btn-ghost ${size}`} disabled={busy === 'pdf'} onClick={() => handle('pdf')}>{busy === 'pdf' ? '…' : 'PDF'}</button>
      <button type="button" className={`btn-ghost ${size}`} disabled={busy === 'image'} onClick={() => handle('image')}>{busy === 'image' ? '…' : 'Image'}</button>
    </>
  );
}
