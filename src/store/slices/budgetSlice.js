// src/store/slices/budgetSlice.js
import * as budgetService from '../../services/budgetService';

export const createBudgetSlice = (set, get) => ({
  // ── State ──
  budgets: {},   // { "Food": 5000, "Transport": 3000, ... }

  // ── Setters (called by subscription hook) ──
  setBudgets: (budgets) =>
    set({ budgets }, false, 'budgets/set'),

  // ── Actions ──
  saveBudgets: async (newBudgets) => {
    const uid = get().auth.user?.uid;
    if (!uid) return;
    set({ budgets: newBudgets }, false, 'budgets/save');
    try {
      await budgetService.saveBudgets(uid, newBudgets);
    } catch {
      // already updated locally above
    }
    get().closeModal();
    get().showToast('Budgets updated');
  },
});
