# MoneyLens — React App

A personal finance tracker built with React + Vite, styled with plain CSS,
and wired for Firebase Firestore.

---

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173

---

## Firebase Setup

### 1. Install & configure

Fill in `src/firebase.js` with your project credentials:

```js
const firebaseConfig = {
  apiKey:            'YOUR_API_KEY',
  authDomain:        'YOUR_PROJECT.firebaseapp.com',
  projectId:         'YOUR_PROJECT_ID',
  storageBucket:     'YOUR_PROJECT.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId:             'YOUR_APP_ID',
};
```

### 2. Firestore collection structure

```
expenses/
  {id}  →  { name, amount, cat, date, note, uid, createdAt }

recurring/
  {id}  →  { name, amount, cat, day, due, active, uid, createdAt }

goals/
  {id}  →  { name, target, saved, deadline, uid, createdAt }

budgets/
  {uid} →  { Food, Transport, Shopping, Bills, Health, Fun, Other }
```

### 3. Wiring Firestore into the app

Replace the seed data and local state in `App.jsx` with Firestore listeners.
Example for expenses:

```js
import { collection, query, where, orderBy, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

// In App component, replace useState(SEED_EXPENSES) with:
useEffect(() => {
  if (!user) return;
  const q = query(
    collection(db, 'expenses'),
    where('uid', '==', user.uid),
    orderBy('createdAt', 'desc')
  );
  const unsub = onSnapshot(q, (snap) => {
    setExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
  return unsub;
}, [user]);

// Replace addExpense with:
const addExpense = async (form) => {
  await addDoc(collection(db, 'expenses'), {
    ...form,
    uid: user.uid,
    createdAt: serverTimestamp(),
  });
  closeModal();
  toast.show('Transaction recorded');
};

// Replace deleteExpense with:
const deleteExpense = async (id) => {
  await deleteDoc(doc(db, 'expenses', id));
  toast.show('Removed');
};
```

Repeat the same pattern for `recurring`, `goals`, and `budgets`.

---

## File Structure

```
moneylens/
├── index.html
├── vite.config.js
├── package.json
└── src/
    ├── main.jsx        ← React entry point
    ├── App.jsx         ← All pages, components, and modals
    ├── index.css       ← Global styles (design tokens + all component CSS)
    ├── firebase.js     ← Firebase init (fill in your config)
    └── utils.js        ← Constants, helpers, SVG icon components
```

---

## Pages

| Page       | Route key    | Description                              |
|------------|--------------|------------------------------------------|
| Dashboard  | `dashboard`  | Hero stats, sparkline, donut, recent txns |
| Expenses   | `expenses`   | Searchable, sortable, filterable table    |
| Budgets    | `budgets`    | Per-category progress bars, editable      |
| Recurring  | `recurring`  | Bill Shield — due-date alerts             |
| Goals      | `goals`      | Savings targets with contribute flow      |
| Insights   | `insights`   | Bar chart, recommendation, over/under     |
