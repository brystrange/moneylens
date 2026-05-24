// src/services/expenseService.js
import {
  collection, onSnapshot, addDoc, deleteDoc, doc,
  serverTimestamp, query, orderBy,
} from 'firebase/firestore';
import { db } from '../firebase';

const userCol = (uid) => collection(db, 'users', uid, 'expenses');
const userDoc = (uid, id) => doc(db, 'users', uid, 'expenses', id);

/**
 * Subscribe to real-time expense updates.
 * @param {string} uid
 * @param {(items: any[]) => void} onData
 * @param {(err: Error) => void} onError
 * @returns {() => void} unsubscribe
 */
export function subscribeExpenses(uid, onData, onError) {
  return onSnapshot(
    query(userCol(uid), orderBy('createdAt', 'desc')),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => onError(err),
  );
}

/**
 * Add a new expense.
 * @param {string} uid
 * @param {{ name: string, amount: number, date: string, cat: string, note?: string }} form
 */
export async function addExpense(uid, form) {
  return addDoc(userCol(uid), { ...form, createdAt: serverTimestamp() });
}

/**
 * Delete an expense by ID.
 * @param {string} uid
 * @param {string} id
 */
export async function removeExpense(uid, id) {
  return deleteDoc(userDoc(uid, id));
}
