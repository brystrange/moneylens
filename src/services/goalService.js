// src/services/goalService.js
import {
  collection, onSnapshot, addDoc, deleteDoc, updateDoc, doc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

const userCol = (uid) => collection(db, 'users', uid, 'goals');
const userDoc = (uid, id) => doc(db, 'users', uid, 'goals', id);

/**
 * Subscribe to real-time goal updates.
 * @param {string} uid
 * @param {(items: any[]) => void} onData
 * @param {(err: Error) => void} onError
 * @returns {() => void} unsubscribe
 */
export function subscribeGoals(uid, onData, onError) {
  return onSnapshot(
    userCol(uid),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => onError(err),
  );
}

/**
 * Add a new savings goal.
 * @param {string} uid
 * @param {object} form
 */
export async function addGoal(uid, form) {
  return addDoc(userCol(uid), { ...form, createdAt: serverTimestamp() });
}

/**
 * Update a goal (e.g. contribute).
 * @param {string} uid
 * @param {string} id
 * @param {object} fields
 */
export async function updateGoal(uid, id, fields) {
  return updateDoc(userDoc(uid, id), fields);
}

/**
 * Delete a goal.
 * @param {string} uid
 * @param {string} id
 */
export async function removeGoal(uid, id) {
  return deleteDoc(userDoc(uid, id));
}
