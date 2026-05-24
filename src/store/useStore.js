// src/store/useStore.js
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { createAuthSlice } from './slices/authSlice';
import { createExpenseSlice } from './slices/expenseSlice';
import { createBillSlice } from './slices/billSlice';
import { createGoalSlice } from './slices/goalSlice';
import { createBudgetSlice } from './slices/budgetSlice';
import { createPayoutSlice } from './slices/payoutSlice';
import { createConfigSlice } from './slices/configSlice';
import { createUISlice } from './slices/uiSlice';

const useStore = create(
  devtools(
    (...a) => ({
      ...createAuthSlice(...a),
      ...createExpenseSlice(...a),
      ...createBillSlice(...a),
      ...createGoalSlice(...a),
      ...createBudgetSlice(...a),
      ...createPayoutSlice(...a),
      ...createConfigSlice(...a),
      ...createUISlice(...a),
    }),
    { name: 'MoneyLens' },
  ),
);

export default useStore;
