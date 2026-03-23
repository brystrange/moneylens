// src/firebase.js
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyAnhYobgYSi69IRnoV-hW1XXTHzi9FqJ-Y",
  authDomain: "moneylens-tracker.firebaseapp.com",
  projectId: "moneylens-tracker",
  storageBucket: "moneylens-tracker.firebasestorage.app",
  messagingSenderId: "196676357335",
  appId: "1:196676357335:web:5f59e1cb1072bde209f492",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export default app;