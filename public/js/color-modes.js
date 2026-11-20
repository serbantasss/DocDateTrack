/*!
 * Color mode toggler for Bootstrap's docs (https://getbootstrap.com/)
 * Copyright 2011-2025 The Bootstrap Authors
 * Licensed under the Creative Commons Attribution 3.0 Unported License.
 */

/*
 * Adapted for DocDateTrack: Bootstrap Icons instead of an SVG sprite, any number of toggles per
 * page (`[data-theme-switcher]` containing `[data-theme-toggle]` and `[data-bs-theme-value]`
 * items), "auto" as the default choice, and storage errors (e.g. disabled storage) are ignored.
 * Loaded in <head> so the stored colour mode applies before the first paint.
 */
(() => {
  'use strict';

  const THEMES = ['light', 'dark', 'auto'];
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

  const getStoredTheme = () => {
    try {
      return localStorage.getItem('theme');
    } catch {
      return null;
    }
  };

  const setStoredTheme = (theme) => {
    try {
      localStorage.setItem('theme', theme);
    } catch {
      // Storage unavailable: the choice applies to this page only.
    }
  };

  const getPreferredTheme = () => {
    const storedTheme = getStoredTheme();
    return THEMES.includes(storedTheme) ? storedTheme : 'auto';
  };

  const setTheme = (theme) => {
    const resolved = theme === 'auto' ? (prefersDark.matches ? 'dark' : 'light') : theme;
    document.documentElement.setAttribute('data-bs-theme', resolved);
  };

  setTheme(getPreferredTheme());

  const showActiveTheme = (theme, focusSwitcher = null) => {
    document.querySelectorAll('[data-theme-switcher]').forEach((switcher) => {
      const toggle = switcher.querySelector('[data-theme-toggle]');
      const activeItem = switcher.querySelector(`[data-bs-theme-value="${theme}"]`);
      if (!toggle || !activeItem) return;

      switcher.querySelectorAll('[data-bs-theme-value]').forEach((item) => {
        item.classList.remove('active');
        item.setAttribute('aria-pressed', 'false');
      });
      activeItem.classList.add('active');
      activeItem.setAttribute('aria-pressed', 'true');

      const activeIcon = toggle.querySelector('.theme-icon-active');
      if (activeIcon && activeItem.dataset.themeIcon) {
        activeIcon.className = `bi ${activeItem.dataset.themeIcon} theme-icon-active`;
      }
      toggle.setAttribute('aria-label', `Toggle theme (${theme})`);

      if (switcher === focusSwitcher) toggle.focus();
    });
  };

  prefersDark.addEventListener('change', () => {
    const storedTheme = getStoredTheme();
    if (storedTheme !== 'light' && storedTheme !== 'dark') {
      setTheme(getPreferredTheme());
    }
  });

  window.addEventListener('DOMContentLoaded', () => {
    showActiveTheme(getPreferredTheme());

    document.querySelectorAll('[data-bs-theme-value]').forEach((item) => {
      item.addEventListener('click', () => {
        const theme = item.getAttribute('data-bs-theme-value');
        setStoredTheme(theme);
        setTheme(theme);
        showActiveTheme(theme, item.closest('[data-theme-switcher]'));
      });
    });
  });
})();
