// src/store/slices/configSlice.js

const CURRENCY_SYMBOLS = {
  PHP: '₱', USD: '$', EUR: '€', GBP: '£', JPY: '¥',
  SGD: 'S$', AUD: 'A$', CAD: 'C$',
};

export const createConfigSlice = (set, get) => ({
  // ── State ──
  config: {
    currency: localStorage.getItem('ml_currency') || 'PHP',
    customCats: [],   // inferred from budgets + explicitly added
  },

  // ── Derived ──
  // Currency symbol and format function — accessible from any slice via get().fmt
  get currSymbol() {
    return CURRENCY_SYMBOLS[get().config.currency] || '₱';
  },

  fmt: (n) => {
    const sym = CURRENCY_SYMBOLS[get().config.currency] || '₱';
    return sym + Math.round(n).toLocaleString('en-PH');
  },

  // ── Actions ──
  setCurrency: (code) => {
    localStorage.setItem('ml_currency', code);
    set(
      (s) => ({ config: { ...s.config, currency: code } }),
      false,
      'config/setCurrency',
    );
  },

  setCustomCats: (cats) =>
    set(
      (s) => ({ config: { ...s.config, customCats: cats } }),
      false,
      'config/setCustomCats',
    ),

  addCustomCat: (name) => {
    if (name.startsWith('__delete__')) {
      const cat = name.replace('__delete__', '');
      set(
        (s) => ({
          config: {
            ...s.config,
            customCats: s.config.customCats.filter((c) => c !== cat),
          },
        }),
        false,
        'config/removeCat',
      );
      // Also remove from budgets and save
      const nb = { ...get().budgets };
      delete nb[cat];
      get().saveBudgets(nb);
      get().showToast(cat + ' category removed');
    } else {
      set(
        (s) => ({
          config: {
            ...s.config,
            customCats: [...s.config.customCats, name],
          },
        }),
        false,
        'config/addCat',
      );
      get().showToast(name + ' category added');
    }
  },
});
