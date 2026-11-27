import { useEffect, useRef, useState } from 'react';

const MAX_BYTES = 10 * 1024 * 1024;

// Photo picker with preview. On phones/tablets the "Take Photo" button opens
// the camera directly; "Choose File" picks from the gallery / disk.
export default function PhotoInput({ currentPhoto, file, onChange, onRemove, label = 'Photo' }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const cameraRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!file) { setPreview(null); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pick(e) {
    const chosen = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!chosen) return;
    if (!/^image\//.test(chosen.type)) { setError('Please choose an image (JPG, PNG, WEBP).'); return; }
    if (chosen.size > MAX_BYTES) { setError('Photo is larger than 10 MB.'); return; }
    setError('');
    onChange(chosen);
  }

  const shown = preview || (currentPhoto ? `/uploads/${encodeURIComponent(currentPhoto)}` : null);

  return (
    <div className="field">
      <label>{label}</label>
      <div className="photo-input">
        <div className="photo-preview">
          {shown ? <img src={shown} alt="Selected" /> : <span className="muted">No photo</span>}
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <div className="row" style={{ margin: 0 }}>
            <button type="button" className="btn-secondary btn-sm" onClick={() => fileRef.current.click()}>Choose File</button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => cameraRef.current.click()}>Take Photo</button>
            {(file || currentPhoto) && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => (file ? onChange(null) : onRemove && onRemove())}>
                {file ? 'Undo' : 'Remove'}
              </button>
            )}
          </div>
          <span className="muted" style={{ fontSize: '0.78rem' }}>JPG, PNG or WEBP, up to 10 MB.</span>
          {error && <span style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>{error}</span>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      </div>
    </div>
  );
}
