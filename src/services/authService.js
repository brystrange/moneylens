// src/services/authService.js
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { auth } from '../firebase';

const googleProvider = new GoogleAuthProvider();

/**
 * Subscribe to auth state changes.
 * @param {(user: import('firebase/auth').User | null) => void} callback
 * @returns {() => void} unsubscribe
 */
export function subscribeAuth(callback) {
  return onAuthStateChanged(auth, (u) => callback(u ?? null));
}

/**
 * Sign in with email/password.
 */
export async function signInEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

/**
 * Create account with email/password.
 */
export async function signUpEmail(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}

/**
 * Sign in with Google popup.
 */
export async function signInGoogle() {
  return signInWithPopup(auth, googleProvider);
}

/**
 * Sign out.
 */
export async function signOut() {
  return firebaseSignOut(auth);
}
