// src/store/slices/billSlice.js
import * as billService from '../../services/billService';

export const createBillSlice = (set, get) => ({
  // ── State ──
  bills: { items: [], loading: true },

  // ── Setters (called by subscription hook) ──
  setBills: (items) =>
    set(
      (s) => ({ bills: { ...s.bills, items, loading: false } }),
      false,
      'bills/set',
    ),

  setBillsLoading: (loading) =>
    set(
      (s) => ({ bills: { ...s.bills, loading } }),
      false,
      'bills/setLoading',
    ),

  // ── Actions ──
  addBill: async (form) => {
    const uid = get().auth.user?.uid;
    if (!uid) return;
    try {
      await billService.addBill(uid, form);
      get().showToast('Recurring bill added');
      get().closeModal();
    } catch {
      set(
        (s) => ({
          bills: {
            ...s.bills,
            items: [...s.bills.items, { id: Date.now().toString(), active: true, ...form }],
          },
        }),
        false,
        'bills/addFallback',
      );
      get().showToast('Saved locally');
      get().closeModal();
    }
  },

  editBill: async ({ id, ...fields }) => {
    const uid = get().auth.user?.uid;
    if (!uid) return;
    try {
      await billService.updateBill(uid, id, fields);
      get().showToast('Bill updated');
    } catch {
      set(
        (s) => ({
          bills: {
            ...s.bills,
            items: s.bills.items.map((r) => (r.id === id ? { ...r, ...fields } : r)),
          },
        }),
        false,
        'bills/editFallback',
      );
      get().showToast('Updated locally');
    }
  },

  toggleBill: async (id) => {
    const uid = get().auth.user?.uid;
    if (!uid) return;
    const r = get().bills.items.find((r) => r.id === id);
    if (!r) return;
    try {
      await billService.updateBill(uid, id, { active: !r.active });
    } catch {
      set(
        (s) => ({
          bills: {
            ...s.bills,
            items: s.bills.items.map((r) => (r.id === id ? { ...r, active: !r.active } : r)),
          },
        }),
        false,
        'bills/toggleFallback',
      );
    }
  },

  markBillPaid: async (id) => {
    const uid = get().auth.user?.uid;
    if (!uid) return;
    const r = get().bills.items.find((r) => r.id === id);
    if (!r) return;
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const paidMonths = r.paidMonths || [];
    if (paidMonths.includes(monthKey)) return;
    const newPaid = [...paidMonths, monthKey];

    // Advance due date by one month
    let nextDue = r.due || '';
    if (nextDue) {
      const d = new Date(nextDue + 'T00:00:00');
      d.setMonth(d.getMonth() + 1);
      const pad = (n) => String(n).padStart(2, '0');
      nextDue = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    const update = { paidMonths: newPaid, ...(nextDue && { due: nextDue }) };
    try {
      await billService.updateBill(uid, id, update);
    } catch {
      // no-op — Firestore snapshot will sync
    }
    // Always update local state immediately
    set(
      (s) => ({
        bills: {
          ...s.bills,
          items: s.bills.items.map((r) => (r.id === id ? { ...r, ...update } : r)),
        },
      }),
      false,
      'bills/markPaid',
    );
    get().showToast(`${r.name} marked as paid`);
  },

  markBillUnpaid: async (id) => {
    const uid = get().auth.user?.uid;
    if (!uid) return;
    const r = get().bills.items.find((r) => r.id === id);
    if (!r) return;
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const paidMonths = r.paidMonths || [];
    if (!paidMonths.includes(monthKey)) return;
    const newPaid = paidMonths.filter((m) => m !== monthKey);
    const update = { paidMonths: newPaid };
    try {
      await billService.updateBill(uid, id, update);
    } catch {
      // no-op — Firestore snapshot will sync
    }
    set(
      (s) => ({
        bills: {
          ...s.bills,
          items: s.bills.items.map((r) => (r.id === id ? { ...r, ...update } : r)),
        },
      }),
      false,
      'bills/markUnpaid',
    );
    get().showToast(`${r.name} marked as unpaid`);
  },

  markBillFullyPaid: async (id) => {
    const uid = get().auth.user?.uid;
    if (!uid) return;
    const r = get().bills.items.find((r) => r.id === id);
    if (!r) return;
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const paidMonths = r.paidMonths || [];
    const update = {
      fullyPaid: true,
      active: false,
      paidMonths: paidMonths.includes(monthKey) ? paidMonths : [...paidMonths, monthKey],
    };
    try {
      await billService.updateBill(uid, id, update);
    } catch {
      // no-op — Firestore snapshot will sync
    }
    set(
      (s) => ({
        bills: {
          ...s.bills,
          items: s.bills.items.map((r) => (r.id === id ? { ...r, ...update } : r)),
        },
      }),
      false,
      'bills/markFullyPaid',
    );
    get().showToast(`${r.name} marked as fully paid`);
  },

  deleteBill: async (id) => {
    const uid = get().auth.user?.uid;
    if (!uid) return;
    try {
      await billService.removeBill(uid, id);
    } catch {
      set(
        (s) => ({
          bills: {
            ...s.bills,
            items: s.bills.items.filter((r) => r.id !== id),
          },
        }),
        false,
        'bills/removeFallback',
      );
    }
    get().showToast('Removed');
  },

  confirmDeleteBill: (id) => {
    const item = get().bills.items.find((r) => r.id === id);
    get().requestDelete({ id, name: item?.name || 'this bill', type: 'recurring' });
  },
});
