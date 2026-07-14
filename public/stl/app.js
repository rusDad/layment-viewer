import { createStlViewer } from './StlViewer.js';
import { buildStlPreviewUrlFromUploadId } from '../routing.js';

const stlFileInput = document.getElementById('stl-file');
const stlUploadButton = document.getElementById('stl-upload');
const stlStatusEl = document.getElementById('stl-status');
const stlLinkEl = document.getElementById('stl-link');

const stlUploadController = createStlViewer({
  stlFileInput,
  setStlUploadState,
  setStlUploadLink,
  buildPreviewUrl
});

stlUploadButton?.addEventListener('click', stlUploadController.uploadStl);
window.addEventListener('pagehide', () => {
  stlUploadButton?.removeEventListener('click', stlUploadController.uploadStl);
}, { once: true });

function setStlUploadState(message, isError = false) {
  if (!stlStatusEl) return;
  stlStatusEl.textContent = message || '';
  stlStatusEl.classList.toggle('status-error', Boolean(message) && isError);
  stlStatusEl.classList.toggle('status-meta', Boolean(message) && !isError);
}

function setStlUploadLink(url) {
  if (!stlLinkEl) return;
  stlLinkEl.innerHTML = '';
  if (!url) return;
  const text = document.createElement('code');
  text.textContent = url;
  const link = document.createElement('a');
  link.href = url;
  link.textContent = 'Открыть preview';
  stlLinkEl.append(text, link);
}

function buildPreviewUrl(uploadResponseUrl) {
  const stlId = new URLSearchParams(String(uploadResponseUrl || '').replace(/^\?/, '')).get('stl')?.trim();
  return buildStlPreviewUrlFromUploadId(stlId || '', window.location.href);
}
