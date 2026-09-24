(function attachFavoriteManager(root) {
  'use strict';

  const STORAGE_KEY = 'poe_ninja_favorite_characters';

  async function getFavorites() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.storage?.local) {
        const data = await chrome.storage.local.get(STORAGE_KEY);
        if (Array.isArray(data[STORAGE_KEY])) {
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data[STORAGE_KEY])); } catch (_) {}
          return data[STORAGE_KEY];
        }
      }
    } catch (_) {
      // 扩展重新加载导致的上下文失效，降级使用本地存储
    }
    try {
      const local = localStorage.getItem(STORAGE_KEY);
      return local ? JSON.parse(local) : [];
    } catch (_) {
      return [];
    }
  }

  async function saveFavorites(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (_) {}
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.storage?.local) {
        await chrome.storage.local.set({ [STORAGE_KEY]: list });
        return true;
      }
    } catch (_) {
      // 扩展重新加载导致的上下文失效，已保存在 localStorage
    }
    return true;
  }

  function normalizeUrl(url) {
    if (!url) return '';
    const clean = String(url).split('?')[0].split('#')[0];
    const path = clean.replace(/^https?:\/\/[^\/]+/i, '');
    return path.startsWith('/') ? path : `/${path}`;
  }

  async function isFavorited(characterUrl) {
    if (!characterUrl) return false;
    const targetPath = normalizeUrl(characterUrl);
    const favorites = await getFavorites();
    return favorites.some((f) => normalizeUrl(f.url) === targetPath);
  }

  async function toggleFavorite(characterData) {
    if (!characterData || !characterData.url) return { favorited: false, count: 0 };
    const targetPath = normalizeUrl(characterData.url);
    const favorites = await getFavorites();
    const existingIndex = favorites.findIndex((f) => normalizeUrl(f.url) === targetPath);

    if (existingIndex >= 0) {
      favorites.splice(existingIndex, 1);
      await saveFavorites(favorites);
      return { favorited: false, count: favorites.length };
    } else {
      const newEntry = {
        id: characterData.id || `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        url: characterData.url,
        name: characterData.name || 'Unknown',
        account: characterData.account || '',
        level: characterData.level || '',
        classTitle: characterData.classTitle || '',
        classAvatar: characterData.classAvatar || '',
        life: characterData.life || '-',
        es: characterData.es || '-',
        ehp: characterData.ehp || '-',
        dps: characterData.dps || '-',
        mainSkillIcon: characterData.mainSkillIcon || '',
        mainSkillName: characterData.mainSkillName || '',
        keystones: Array.isArray(characterData.keystones) ? characterData.keystones : [],
        addedAt: Date.now(),
      };
      favorites.unshift(newEntry);
      await saveFavorites(favorites);
      return { favorited: true, count: favorites.length };
    }
  }

  async function removeFavorite(characterUrlOrId) {
    const favorites = await getFavorites();
    const filtered = favorites.filter((f) => f.id !== characterUrlOrId && normalizeUrl(f.url) !== normalizeUrl(characterUrlOrId));
    await saveFavorites(filtered);
    return filtered.length;
  }

  function parseMetricNumber(val) {
    if (!val || val === '-') return 0;
    const s = String(val).trim().toUpperCase();
    let num = parseFloat(s.replace(/[^0-9.]/g, '')) || 0;
    if (s.includes('K')) num *= 1000;
    if (s.includes('M')) num *= 1000000;
    if (s.includes('B')) num *= 1000000000;
    return num;
  }

  function filterAndSortFavorites(list, searchQuery = '', sortBy = 'time_desc') {
    let result = [...(list || [])];
    if (searchQuery && typeof searchQuery === 'string') {
      const q = searchQuery.trim().toLowerCase();
      if (q) {
        result = result.filter((item) => (
          (item.name || '').toLowerCase().includes(q)
          || (item.account || '').toLowerCase().includes(q)
          || (item.classTitle || '').toLowerCase().includes(q)
          || (item.mainSkillName || '').toLowerCase().includes(q)
        ));
      }
    }

    switch (sortBy) {
      case 'dps_desc':
        result.sort((a, b) => parseMetricNumber(b.dps) - parseMetricNumber(a.dps));
        break;
      case 'dps_asc':
        result.sort((a, b) => parseMetricNumber(a.dps) - parseMetricNumber(b.dps));
        break;
      case 'ehp_desc':
        result.sort((a, b) => parseMetricNumber(b.ehp) - parseMetricNumber(a.ehp));
        break;
      case 'life_desc':
        result.sort((a, b) => parseMetricNumber(b.life) - parseMetricNumber(a.life));
        break;
      case 'es_desc':
        result.sort((a, b) => parseMetricNumber(b.es) - parseMetricNumber(a.es));
        break;
      case 'level_desc':
        result.sort((a, b) => (parseInt(b.level, 10) || 0) - (parseInt(a.level, 10) || 0));
        break;
      case 'time_desc':
      default:
        result.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
        break;
    }
    return result;
  }

  const manager = {
    STORAGE_KEY,
    getFavorites,
    saveFavorites,
    isFavorited,
    toggleFavorite,
    removeFavorite,
    filterAndSortFavorites,
    normalizeUrl,
    parseMetricNumber,
  };

  root.PoeNinjaFavoriteManager = manager;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = manager;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
