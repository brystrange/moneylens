// src/store/slices/goalSlice.js
import * as goalService from '../../services/goalService';

export const createGoalSlice = (set, get) => ({
  // ── State ──
  goals: { items: [], loading: true },

  // ── Setters (called by subscription hook) ──
  setGoals: (items) =>
    set(
      (s) => ({ goals: { ...s.goals, items, loading: false } }),
      false,
      'goals/set',
    ),

  setGoalsLoading: (loading) =>
    set(
      (s) => ({ goals: { ...s.goals, loading } }),
      false,
      'goals/setLoading',
    ),

  // ── Actions ──
  addGoal: async (form) => {
    const uid = get().auth.user?.uid;
    if (!uid) return;
    try {
      await goalService.addGoal(uid, form);
      get().showToast('Goal created');
      get().closeModal();
    } catch {
      set(
        (s) => ({
          goals: {
            ...s.goals,
            items: [...s.goals.items, { id: Date.now().toString(), ...form }],
          },
        }),
        false,
        'goals/addFallback',
      );
      get().showToast('Saved locally');
      get().closeModal();
    }
  },

  contributeGoal: async (id, amount) => {
    const uid = get().auth.user?.uid;
    if (!uid) return;
    const g = get().goals.items.find((g) => g.id === id);
    if (!g) return;
    const newSaved = Math.min(g.target, g.saved + amount);
    try {
      await goalService.updateGoal(uid, id, { saved: newSaved });
    } catch {
      set(
        (s) => ({
          goals: {
            ...s.goals,
            items: s.goals.items.map((g) => (g.id === id ? { ...g, saved: newSaved } : g)),
          },
        }),
        false,
        'goals/contributeFallback',
      );
    }
    const fmt = get().fmt;
    get().closeModal();
    get().showToast(`${fmt(amount)} added`);
  },

  deleteGoal: async (id) => {
    const uid = get().auth.user?.uid;
    if (!uid) return;
    try {
      await goalService.removeGoal(uid, id);
    } catch {
      set(
        (s) => ({
          goals: {
            ...s.goals,
            items: s.goals.items.filter((g) => g.id !== id),
          },
        }),
        false,
        'goals/removeFallback',
      );
    }
    get().showToast('Goal removed');
  },

  confirmDeleteGoal: (id) => {
    const item = get().goals.items.find((g) => g.id === id);
    get().requestDelete({ id, name: item?.name || 'this goal', type: 'goal' });
  },
});
