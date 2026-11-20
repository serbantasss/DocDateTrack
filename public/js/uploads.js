/*
 * DocDateTrack — file upload fields.
 *
 * input[type=file][data-max-bytes]: refuse a file above the size limit before the form is sent
 * (the server checks again). The message comes from data-size-error.
 */
(() => {
  'use strict';

  document.addEventListener('change', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'file') return;
    const maxBytes = Number(input.dataset.maxBytes);
    if (!maxBytes) return;
    const tooLarge = Array.from(input.files || []).some((file) => file.size > maxBytes);
    input.setCustomValidity(tooLarge ? input.dataset.sizeError || 'The file is too large.' : '');
    if (tooLarge) input.reportValidity();
  });
})();
