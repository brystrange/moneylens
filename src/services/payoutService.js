// src/services/payoutService.js
import { onSnapshot, setDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';

const payoutDoc = (uid) => doc(db, 'users', uid, 'config', 'payoutSchedule');

/**
 * Subscribe to real-time payout schedule updates.
 * @param {string} uid
 * @param {(schedule: object | null) => void} onData
 * @param {(err: Error) => void} onError
 * @returns {() => void} unsubscribe
 */
export function subscribePayoutSchedule(uid, onData, onError) {
  return onSnapshot(
    payoutDoc(uid),
    (snap) => {
      if (snap.exists()) {
        onData(snap.data());
      }
    },
    (err) => onError(err),
  );
}

/**
 * Save payout schedule (full overwrite).
 * @param {string} uid
 * @param {object} schedule
 */
export async function savePayoutSchedule(uid, schedule) {
  return setDoc(payoutDoc(uid), schedule);
}
