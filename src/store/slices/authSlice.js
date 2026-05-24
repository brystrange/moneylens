// src/store/slices/authSlice.js

export const createAuthSlice = (set) => ({
  // ── State ──
  auth: {
    user: undefined,   // undefined = loading, null = signed out, object = signed in
    loading: true,
  },

  // ── Actions ──
  setUser: (user) =>
    set(
      { auth: { user: user ?? null, loading: false } },
      false,
      'auth/setUser',
    ),
});
