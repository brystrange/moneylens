// src/services/budgetService.js
import { onSnapshot, setDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';

const budgetDoc = (uid) => doc(db, 'users', uid, 'config', 'budgets');

/**
 * Subscribe to real-time budget config updates.
 * Cleans out zero-value entries before returning.
 * @param {string} uid
 * @param {(budgets: Record<string, number>) => void} onData
 * @param {(err: Error) => void} onError
 * @returns {() => void} unsubscribe
 */
export function subscribeBudgets(uid, onData, onError) {
  return onSnapshot(
    budgetDoc(uid),
    (snap) => {
      if (snap.exists()) {
        const raw = snap.data();
        const cleaned = {};
        for (const [k, v] of Object.entries(raw)) {
          if (v > 0) cleaned[k] = v;
        }
        onData(cleaned);
      }
    },
    (err) => onError(err),
  );
}

/**
 * Save budget limits (full overwrite).
 * @param {string} uid
 * @param {Record<string, number>} budgets
 */
export async function saveBudgets(uid, budgets) {
  return setDoc(budgetDoc(uid), budgets);
}
