// src/hooks/useAuthSubscription.js
import { useEffect } from 'react';
import { subscribeAuth } from '../services/authService';
import useStore from '../store/useStore';

/**
 * Subscribes to Firebase Auth state changes and syncs into the Zustand store.
 * Should be called once at app root level.
 */
export function useAuthSubscription() {
  const setUser = useStore((s) => s.setUser);

  useEffect(() => {
    const unsub = subscribeAuth((user) => {
      setUser(user);
    });
    return unsub;
  }, [setUser]);
}
