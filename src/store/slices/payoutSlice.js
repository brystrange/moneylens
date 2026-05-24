// src/store/slices/payoutSlice.js
import * as payoutService from '../../services/payoutService';

export const createPayoutSlice = (set, get) => ({
  // ── State ──
  payoutSchedule: null,

  // ── Setters (called by subscription hook) ──
  setPayoutSchedule: (schedule) =>
    set({ payoutSchedule: schedule }, false, 'payout/set'),

  // ── Actions ──
  // Writes to Firestore FIRST, then updates local state on success.
  // Throws on failure so the UI (Settings) can display errors.
  savePayoutSchedule: async (schedule) => {
    const uid = get().auth.user?.uid;
    if (!uid) return;
    await payoutService.savePayoutSchedule(uid, schedule);
    set({ payoutSchedule: schedule }, false, 'payout/save');
    get().showToast('Payout schedule saved');
  },
});
