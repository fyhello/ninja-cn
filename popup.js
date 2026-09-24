'use strict';

const languages = ['en', 'zh-CN', 'zh-TW'];

function updateActiveLanguage(language) {
  for (const candidate of languages) {
    const button = document.getElementById(`btn-${candidate}`);
    const active = candidate === language;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

async function setLanguage(language) {
  const result = await chrome.runtime.sendMessage({ type: 'SET_LANGUAGE', language });
  if (!result?.ok) throw new Error(result?.error ?? 'Could not save language');
  updateActiveLanguage(language);
}

async function initialise() {
  const result = await chrome.runtime.sendMessage({ type: 'GET_LANGUAGE' });
  updateActiveLanguage(result?.ok ? result.language : 'en');

  for (const language of languages) {
    document.getElementById(`btn-${language}`).addEventListener('click', () => {
      setLanguage(language).catch((error) => console.error('[POE Ninja translation]', error));
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initialise().catch((error) => console.error('[POE Ninja translation]', error));
});
