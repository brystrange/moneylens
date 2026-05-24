// src/store/slices/uiSlice.js

export const createUISlice = (set, get) => ({
  // ── State ──
  ui: {
    page: 'dashboard',
    modal: null,          // 'add-expense' | 'edit-budgets' | 'add-recurring' | 'add-goal' | 'contribute' | 'add-category' | null
    modalData: null,      // payload for modals that need context (e.g. goal to contribute to)
    menuOpen: false,      // mobile drawer
    confirmDelete: null,  // { id, name, type } or null
    signOutConfirm: false,
    toast: { msg: '', visible: false },
  },

  // ── Actions ──
  setPage: (page) =>
    set(
      (s) => ({ ui: { ...s.ui, page, menuOpen: false } }),
      false,
      'ui/setPage',
    ),

  openModal: (type, data = null) =>
    set(
      (s) => ({ ui: { ...s.ui, modal: type, modalData: data } }),
      false,
      'ui/openModal',
    ),

  closeModal: () =>
    set(
      (s) => ({ ui: { ...s.ui, modal: null, modalData: null } }),
      false,
      'ui/closeModal',
    ),

  toggleMenu: () =>
    set(
      (s) => ({ ui: { ...s.ui, menuOpen: !s.ui.menuOpen } }),
      false,
      'ui/toggleMenu',
    ),

  setMenuOpen: (open) =>
    set(
      (s) => ({ ui: { ...s.ui, menuOpen: open } }),
      false,
      'ui/setMenuOpen',
    ),

  requestDelete: (item) =>
    set(
      (s) => ({ ui: { ...s.ui, confirmDelete: item } }),
      false,
      'ui/requestDelete',
    ),

  clearDelete: () =>
    set(
      (s) => ({ ui: { ...s.ui, confirmDelete: null } }),
      false,
      'ui/clearDelete',
    ),

  setSignOutConfirm: (open) =>
    set(
      (s) => ({ ui: { ...s.ui, signOutConfirm: open } }),
      false,
      'ui/signOutConfirm',
    ),

  showToast: (msg) => {
    set(
      (s) => ({ ui: { ...s.ui, toast: { msg, visible: true } } }),
      false,
      'ui/showToast',
    );
    setTimeout(() => {
      set(
        (s) => ({ ui: { ...s.ui, toast: { ...s.ui.toast, visible: false } } }),
        false,
        'ui/hideToast',
      );
    }, 2400);
  },
});
