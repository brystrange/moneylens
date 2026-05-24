// src/store/slices/expenseSlice.js
import * as expenseService from '../../services/expenseService';

export const createExpenseSlice = (set, get) => ({
  // ── State ──
  expenses: { items: [], loading: true },

  // ── Setters (called by subscription hook) ──
  setExpenses: (items) =>
    set(
      (s) => ({ expenses: { ...s.expenses, items, loading: false } }),
      false,
      'expenses/set',
    ),

  setExpensesLoading: (loading) =>
    set(
      (s) => ({ expenses: { ...s.expenses, loading } }),
      false,
      'expenses/setLoading',
    ),

  // ── Actions ──
  addExpense: async (form) => {
    const uid = get().auth.user?.uid;
    if (!uid) return;
    try {
      await expenseService.addExpense(uid, form);
      // onSnapshot will push the new doc into items automatically
      get().showToast('Transaction recorded');
      get().closeModal();
    } catch (err) {
      console.error('addExpense error:', err);
      // Optimistic fallback — add locally so user sees it
      set(
        (s) => ({
          expenses: {
            ...s.expenses,
            items: [{ id: Date.now().toString(), ...form }, ...s.expenses.items],
          },
        }),
        false,
        'expenses/addFallback',
      );
      get().showToast('Saved locally — check Firestore rules');
      get().closeModal();
    }
  },

  deleteExpense: async (id) => {
    const uid = get().auth.user?.uid;
    if (!uid) return;
    try {
      await expenseService.removeExpense(uid, id);
    } catch {
      // Remove locally as fallback
      set(
        (s) => ({
          expenses: {
            ...s.expenses,
            items: s.expenses.items.filter((e) => e.id !== id),
          },
        }),
        false,
        'expenses/removeFallback',
      );
    }
    get().showToast('Removed');
  },

  confirmDeleteExpense: (id) => {
    const item = get().expenses.items.find((e) => e.id === id);
    get().requestDelete({ id, name: item?.name || 'this expense', type: 'expense' });
  },
});
