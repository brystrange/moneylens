// src/hooks/useDataSubscription.js
import { useEffect } from 'react';
import useStore from '../store/useStore';
import { subscribeExpenses } from '../services/expenseService';
import { subscribeBills } from '../services/billService';
import { subscribeGoals } from '../services/goalService';
import { subscribeBudgets } from '../services/budgetService';
import { subscribePayoutSchedule } from '../services/payoutService';

/**
 * Subscribes to all Firestore data collections when a user is authenticated.
 * Tears down subscriptions on sign-out or unmount.
 * Should be called once at app root level.
 */
export function useDataSubscription() {
  const uid = useStore((s) => s.auth.user?.uid);
  const setExpenses = useStore((s) => s.setExpenses);
  const setExpensesLoading = useStore((s) => s.setExpensesLoading);
  const setBills = useStore((s) => s.setBills);
  const setGoals = useStore((s) => s.setGoals);
  const setBudgets = useStore((s) => s.setBudgets);
  const setPayoutSchedule = useStore((s) => s.setPayoutSchedule);

  useEffect(() => {
    if (!uid) return;

    // Set loading states
    setExpensesLoading(true);

    const unsubExpenses = subscribeExpenses(
      uid,
      (items) => setExpenses(items),
      (err) => {
        console.error('Firestore expenses error:', err);
        setExpenses([]);
      },
    );

    const unsubBills = subscribeBills(
      uid,
      (items) => setBills(items),
      (err) => {
        console.error('Firestore recurring error:', err);
        setBills([]);
      },
    );

    const unsubGoals = subscribeGoals(
      uid,
      (items) => setGoals(items),
      (err) => {
        console.error('Firestore goals error:', err);
        setGoals([]);
      },
    );

    const unsubBudgets = subscribeBudgets(
      uid,
      (budgets) => setBudgets(budgets),
      () => { /* silent */ },
    );

    const unsubPayout = subscribePayoutSchedule(
      uid,
      (schedule) => setPayoutSchedule(schedule),
      (err) => console.error('Firestore payoutSchedule read error:', err),
    );

    return () => {
      unsubExpenses();
      unsubBills();
      unsubGoals();
      unsubBudgets();
      unsubPayout();
    };
  }, [uid, setExpenses, setExpensesLoading, setBills, setGoals, setBudgets, setPayoutSchedule]);
}
