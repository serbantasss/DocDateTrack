/*
 * DocDateTrack — progressive enhancements driven by data attributes (no inline JavaScript).
 *
 * data-confirm="Message"  on a <form>, a submit button or a link: ask before submitting/following.
 * data-autosubmit         on a form control, a wrapper or a <form>: submit the form on change.
 * data-bs-toggle="tooltip" initialises a Bootstrap tooltip (text from the title attribute).
 */
(() => {
  'use strict';

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const message = event.submitter?.dataset.confirm || form.dataset.confirm;
    if (message && !window.confirm(message)) event.preventDefault();
  });

  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[data-confirm]') : null;
    if (link && !window.confirm(link.dataset.confirm)) event.preventDefault();
  });

  document.addEventListener('change', (event) => {
    const field = event.target;
    if (!(field instanceof Element) || !field.closest('[data-autosubmit]')) return;
    const form = field.form || field.closest('form');
    if (!form) return;
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.submit();
  });

  const initTooltips = () => {
    const Tooltip = window.bootstrap?.Tooltip;
    if (!Tooltip) return;
    document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach((element) => {
      Tooltip.getOrCreateInstance(element);
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTooltips);
  } else {
    initTooltips();
  }
})();
