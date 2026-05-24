// src/services/billService.js
import {
  collection, onSnapshot, addDoc, deleteDoc, updateDoc, doc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

const userCol = (uid) => collection(db, 'users', uid, 'recurring');
const userDoc = (uid, id) => doc(db, 'users', uid, 'recurring', id);

/**
 * Subscribe to real-time recurring bill updates.
 * @param {string} uid
 * @param {(items: any[]) => void} onData
 * @param {(err: Error) => void} onError
 * @returns {() => void} unsubscribe
 */
export function subscribeBills(uid, onData, onError) {
  return onSnapshot(
    userCol(uid),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => onError(err),
  );
}

/**
 * Add a new recurring bill.
 * @param {string} uid
 * @param {object} form
 */
export async function addBill(uid, form) {
  return addDoc(userCol(uid), { ...form, active: true, createdAt: serverTimestamp() });
}

/**
 * Update fields on a recurring bill.
 * @param {string} uid
 * @param {string} id
 * @param {object} fields
 */
export async function updateBill(uid, id, fields) {
  return updateDoc(userDoc(uid, id), fields);
}

/**
 * Delete a recurring bill.
 * @param {string} uid
 * @param {string} id
 */
export async function removeBill(uid, id) {
  return deleteDoc(userDoc(uid, id));
}
