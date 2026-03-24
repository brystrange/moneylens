// src/App.jsx
import { useState, useEffect, useCallback, useRef } from 'react';
import './index.css';
import {
  CATS, peso, catTotals, TIPS,
  CatIcon, TrashIcon, InfoIcon, AlertIcon, PlusIcon, CloseIcon, EditIcon,
} from './utils.jsx';
import {
  collection, onSnapshot, addDoc, deleteDoc, doc,
  updateDoc, setDoc, serverTimestamp, query, orderBy,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
} from 'firebase/auth';

const googleProvider = new GoogleAuthProvider();

// ── Category color map ────────────────────────────────────────
const CAT_BG = {
  Food: 'var(--cat-food-bg)', Transport: 'var(--cat-transport-bg)',
  Shopping: 'var(--cat-shopping-bg)', Bills: 'var(--cat-bills-bg)',
  Health: 'var(--cat-health-bg)',
};
const CAT_FG = {
  Food: 'var(--cat-food)', Transport: 'var(--cat-transport)',
  Shopping: 'var(--cat-shopping)', Bills: 'var(--cat-bills)',
  Health: 'var(--cat-health)',
};

// ── Dynamic colors for custom categories ─────────────────────
const CUSTOM_CAT_PALETTE = [
  { fg: '#E74C3C', bg: 'rgba(231,76,60,.12)' },   // Red
  { fg: '#8E44AD', bg: 'rgba(142,68,173,.12)' },   // Purple
  { fg: '#2980B9', bg: 'rgba(41,128,185,.12)' },   // Blue
  { fg: '#16A085', bg: 'rgba(22,160,133,.12)' },   // Teal
  { fg: '#D35400', bg: 'rgba(211,84,0,.12)' },     // Burnt Orange
  { fg: '#C0392B', bg: 'rgba(192,57,43,.12)' },    // Dark Red
  { fg: '#2ECC71', bg: 'rgba(46,204,113,.12)' },   // Green
  { fg: '#F39C12', bg: 'rgba(243,156,18,.12)' },   // Amber
  { fg: '#1ABC9C', bg: 'rgba(26,188,156,.12)' },   // Mint
  { fg: '#6C5CE7', bg: 'rgba(108,92,231,.12)' },   // Indigo
];
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return Math.abs(h); }
function getCustomCatColor(name) { return CUSTOM_CAT_PALETTE[hashStr(name) % CUSTOM_CAT_PALETTE.length]; }
function getCatFg(cat) { return CAT_FG[cat] || getCustomCatColor(cat).fg; }
function getCatBg(cat) { return CAT_BG[cat] || getCustomCatColor(cat).bg; }


// ─────────────────────────────────────────────────────────────
//  DEFAULT DATA — Firebase is the source of truth
// ─────────────────────────────────────────────────────────────
const DEFAULT_BUDGETS = { Food: 0, Transport: 0, Shopping: 0, Bills: 0, Health: 0 };

// ─────────────────────────────────────────────────────────────
//  TOAST HOOK
// ─────────────────────────────────────────────────────────────
function useToast() {
  const [msg, setMsg] = useState('');
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(null);

  const show = useCallback((text) => {
    setMsg(text);
    setVisible(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 2400);
  }, []);

  return { msg, visible, show };
}

// ─────────────────────────────────────────────────────────────
//  SPENDING WEEK SUMMARY — replaces chart, always fits
// ─────────────────────────────────────────────────────────────
function Sparkline({ expenses, fmt = peso }) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  // Group expenses by day of week
  const byDay = Array(7).fill(0);
  expenses.forEach(e => {
    const d = new Date(e.date);
    if (!isNaN(d)) byDay[d.getDay()] += e.amount;
  });
  const max = Math.max(...byDay, 1);
  const total = byDay.reduce((s, v) => s + v, 0);
  const avg = Math.round(total / 7);
  const peakDay = days[byDay.indexOf(Math.max(...byDay))];

  return (
    <div style={{ width: '100%' }}>
      {/* Mini stat row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[
          { label: 'This Period', val: fmt(total) },
          { label: 'Daily Avg', val: fmt(avg) },
          { label: 'Peak Day', val: peakDay },
        ].map(s => (
          <div key={s.label} style={{ flex: 1, background: 'var(--surface2)', borderRadius: 10, padding: '10px 12px', border: '1.5px solid var(--border)' }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 5 }}>{s.label}</div>
            <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--ink)', lineHeight: 1 }}>{s.val}</div>
          </div>
        ))}
      </div>
      {/* Day-of-week bars — fixed 100px tall, bars use px not % */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 140 }}>
        {days.map((day, i) => {
          const barH = Math.max(Math.round((byDay[i] / max) * 140), 4);
          const today = new Date().getDay() === i;
          return (
            <div key={day} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
              <div style={{
                width: '100%',
                height: barH,
                background: today ? 'var(--ink)' : 'var(--accent)',
                borderRadius: '4px 4px 0 0',
                opacity: today ? 1 : 0.45 + (barH / 100) * 0.55,
              }} />
            </div>
          );
        })}
      </div>
      <div style={{ height: 2, background: 'var(--border)', margin: '0 0 5px' }} />
      <div style={{ display: 'flex', gap: 5 }}>
        {days.map(day => (
          <div key={day} style={{ flex: 1, textAlign: 'center', fontSize: 9, fontWeight: 700, color: 'var(--ink3)' }}>{day}</div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  MINI DONUT COMPONENT
// ─────────────────────────────────────────────────────────────
function MiniDonut({ expenses }) {
  const cats = catTotals(expenses);
  const entries = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
  const R = 26, CX = 34, CY = 34, SW = 8, C = 2 * Math.PI * R;
  const opacities = [0.9, 0.72, 0.56, 0.42, 0.30, 0.20, 0.12];
  let offset = 0;

  const CAT_COLORS_DONUT = {
    Food: '#FF6B35', Transport: '#3498DB', Shopping: '#9B59B6',
    Bills: '#E74C3C', Health: '#2ECC71',
  };
  const getDonutColor = (cat) => CAT_COLORS_DONUT[cat] || getCustomCatColor(cat).fg;

  return (
    <div style={{ width: '100%' }}>
      {/* Donut + top legend row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
        <svg width="64" height="64" viewBox="0 0 68 68" style={{ flexShrink: 0 }}>
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--surface3)" strokeWidth={SW} />
          {entries.map(([cat, v], i) => {
            const frac = v / total;
            const dash = frac * C;
            const dashOffset = -(offset * C);
            const color = getDonutColor(cat);
            const seg = (
              <circle key={i}
                cx={CX} cy={CY} r={R} fill="none"
                stroke={color}
                strokeWidth={SW}
                strokeDasharray={`${dash.toFixed(2)} ${(C - dash).toFixed(2)}`}
                strokeDashoffset={dashOffset.toFixed(2)}
                transform={`rotate(-90 ${CX} ${CY})`}
              />
            );
            offset += frac;
            return seg;
          })}
        </svg>
        {/* Legend dots — 2 column grid */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px' }}>
          {entries.slice(0, 5).map(([cat, v]) => {
            const color = getDonutColor(cat);
            return (
              <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink2)', whiteSpace: 'nowrap' }}>{cat}</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink)', marginLeft: 'auto' }}>{Math.round((v / total) * 100)}%</span>
              </div>
            );
          })}
        </div>
      </div>
      {/* Progress bars — full width, one per category */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {entries.slice(0, 5).map(([cat, v]) => {
          const color = getDonutColor(cat);
          const pct = Math.round((v / total) * 100);
          return (
            <div key={cat}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink2)' }}>{cat}</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink)' }}>{pct}%</span>
              </div>
              <div style={{ height: 6, background: 'var(--surface3)', borderRadius: 999, overflow: 'hidden', border: '1px solid var(--border)' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 999, transition: 'width .6s cubic-bezier(.25,1,.5,1)' }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  MODAL COMPONENT
// ─────────────────────────────────────────────────────────────
function Modal({ open, title, onClose, children, overlayClass }) {
  return (
    <div className={`modal-overlay${open ? ' open' : ''}${overlayClass ? ' ' + overlayClass : ''}`}>
      <div className="modal">
        <div className="modal-hd">
          <span className="modal-title">{title}</span>
          <button className="btn btn-icon btn-ghost" onClick={onClose}><CloseIcon /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  SHARED FIELD COMPONENT
// ─────────────────────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <div className="fg">
      <label className="flabel">{label}</label>
      {children}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
//  SPINNER — used inside modal buttons while saving
// ─────────────────────────────────────────────────────────────
function Spinner({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ animation: 'spin .65s linear infinite', flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2" />
      <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
//  CONFIRM DELETE MODAL
// ─────────────────────────────────────────────────────────────
function ConfirmDelete({ open, itemName, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) setBusy(false); }, [open]);

  const handleConfirm = async () => {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} title="Delete Item" onClose={busy ? undefined : onCancel}>
      <div style={{ textAlign: 'center', padding: '8px 0 20px' }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          background: 'var(--red-bg)', border: '2px solid var(--red)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 16px',
        }}>
          <TrashIcon size={22} style={{ color: 'var(--red)' }} />
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', marginBottom: 8 }}>
          Are you sure?
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink3)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--ink)' }}>{itemName}</strong> will be permanently deleted.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          className="btn"
          style={{ flex: 1, justifyContent: 'center', background: 'var(--red)', color: '#fff', borderColor: 'var(--red)', boxShadow: busy ? 'none' : '3px 3px 0 var(--red-dk)', opacity: busy ? 0.7 : 1 }}
          onClick={handleConfirm}
          disabled={busy}
        >
          {busy ? <><Spinner size={13} /> Deleting…</> : 'Yes, Delete'}
        </button>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
//  PAGE: DASHBOARD
// ─────────────────────────────────────────────────────────────
function Dashboard({ expenses, recurring, goals, budgets, onNav, onAddExpense, fmt = peso }) {
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const totalBudget = Object.values(budgets).reduce((s, v) => s + v, 0);
  const pct = Math.round((total / totalBudget) * 100);
  const recTotal = recurring.filter(r => r.active).reduce((s, r) => s + r.amount, 0);
  const avg = Math.round(total / 15);
  const vals = [1180, 2400, 980, 3200, 1650, 2900, 1420, 2100, 880, 3100, 1900, 2600, 1100, 2800, 1730];
  const up = vals[vals.length - 1] > vals[vals.length - 2];
  const recent = [...expenses].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);

  return (
    <div className="page-enter">
      {/* Hero stat cards */}
      <div className="hero-grid">
        <div className="hero-card accent">
          <div className="hlabel">Total Spent <span style={{ color: 'rgba(255,255,255,.65)', fontWeight: 900 }}>{pct}% of budget</span></div>
          <div className="hval">{fmt(total)}</div>
          <div className="hsub">March 2025</div>
        </div>
        <div className="hero-card">
          <div className="hlabel">Remaining</div>
          <div className="hval">{fmt(Math.max(0, totalBudget - total))}</div>
          <div className="hsub">of {fmt(totalBudget)} limit</div>
        </div>
        <div className="hero-card" style={{ background: 'var(--ink)' }}>
          <div className="hlabel">Daily Average</div>
          <div className="hval">{fmt(avg)}</div>
          <div className="hsub">{fmt(Math.round(avg * 30))} projected</div>
        </div>
        <div className="hero-card" style={{ background: 'var(--ink)' }}>
          <div className="hlabel">Fixed Monthly</div>
          <div className="hval">{fmt(recTotal)}</div>
          <div className="hsub">{recurring.filter(r => r.active).length} active bills</div>
        </div>
      </div>

      {/* Trend + donut row */}
      <div className="g2 gap">
        <div className="card">
          <div className="card-hd">
            <span className="card-title">30-Day Trend</span>
            <span className={`badge ${up ? 'br' : 'bg'}`}>{up ? '↑ Higher today' : '↓ Lower today'}</span>
          </div>
          <div className="card-body" style={{ paddingTop: 16, paddingBottom: 6 }}>
            <Sparkline expenses={expenses} fmt={fmt} />
          </div>
        </div>
        <div className="card">
          <div className="card-hd"><span className="card-title">By Category</span></div>
          <div className="card-body" style={{ paddingTop: 10 }}>
            <MiniDonut expenses={expenses} />
          </div>
        </div>
      </div>

      {/* Recent transactions */}
      <div className="card gap">
        <div className="card-hd">
          <span className="card-title">Recent Transactions</span>
          <button className="btn btn-ghost btn-sm" onClick={() => onNav('expenses')}>All →</button>
        </div>
        <div style={{ padding: '0 22px' }}>
          {recent.map((e, i) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 0', borderBottom: i < recent.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <div className="cat-ico" style={{ background: getCatBg(e.cat), color: getCatFg(e.cat), borderColor: getCatFg(e.cat) }}><CatIcon name={e.cat} size={22} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</div>
                <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2, fontFamily: "'Nunito', sans-serif" }}>{e.cat} · {e.date}</div>
              </div>
              <div style={{ fontFamily: "'Nunito', sans-serif", fontSize: 13, fontWeight: 500, flexShrink: 0 }}>{fmt(e.amount)}</div>
            </div>
          ))}
        </div>
        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border)' }}>
          <button className="btn" onClick={onAddExpense}>
            <PlusIcon /> Record New Expense
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  PAGE: EXPENSES
// ─────────────────────────────────────────────────────────────
function Expenses({ expenses, onDelete, fmt = peso }) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('date-desc');
  const [catF, setCatF] = useState('All');

  const sorted = [...expenses]
    .filter(e => catF === 'All' || e.cat === catF)
    .filter(e => !search || e.name.toLowerCase().includes(search.toLowerCase()))
    .sort({
      'date-desc': (a, b) => new Date(b.date) - new Date(a.date),
      'date-asc': (a, b) => new Date(a.date) - new Date(b.date),
      'amount-desc': (a, b) => b.amount - a.amount,
      'amount-asc': (a, b) => a.amount - b.amount,
    }[sort]);

  const total = sorted.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="page-enter">
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <input className="finput" style={{ flex: 1, minWidth: 160 }} placeholder="Search transactions..." value={search} onChange={e => setSearch(e.target.value)} />
        <div style={{ position: 'relative' }}>
          <select className="finput" style={{ width: 160, paddingRight: 36, appearance: 'none', WebkitAppearance: 'none' }} value={sort} onChange={e => setSort(e.target.value)}>
            <option value="date-desc">Newest first</option>
            <option value="date-asc">Oldest first</option>
            <option value="amount-desc">Highest amount</option>
            <option value="amount-asc">Lowest amount</option>
          </select>
          <div style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--accent)' }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
        </div>
      </div>

      <div className="chips">
        {['All', ...CATS].map(c => (
          <div key={c} className={`chip${catF === c ? ' active' : ''}`} onClick={() => setCatF(c)}>{c}</div>
        ))}
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Description</th>
              <th>Category</th>
              <th className="hide-sm">Date</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th style={{ width: 36 }} />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={5}><div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--ink3)', fontSize: 13 }}>No transactions found</div></td></tr>
            ) : sorted.map(e => (
              <tr key={e.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="cat-ico sm" style={{ background: getCatBg(e.cat), color: getCatFg(e.cat), borderColor: getCatFg(e.cat) }}><CatIcon name={e.cat} size={20} /></div>
                    <div>
                      <div style={{ fontWeight: 500 }}>{e.name}</div>
                      {e.note && <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{e.note}</div>}
                    </div>
                  </div>
                </td>
                <td>
                  <span className="cat-pill" style={{ background: getCatBg(e.cat), color: getCatFg(e.cat), borderColor: getCatFg(e.cat) }}><CatIcon name={e.cat} size={16} />&nbsp;{e.cat}</span>
                </td>
                <td className="hide-sm" style={{ fontSize: 12, color: 'var(--ink3)', fontFamily: "'Nunito', sans-serif" }}>{e.date}</td>
                <td style={{ textAlign: 'right', fontFamily: "'Nunito', sans-serif", fontWeight: 500 }}>{fmt(e.amount)}</td>
                <td>
                  <button className="btn btn-icon btn-ghost btn-delete" style={{ color: '#E74C3C' }} onClick={() => onDelete(e.id)}>
                    <TrashIcon size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--ink3)', fontFamily: "'Nunito', sans-serif" }}>{sorted.length} records</span>
          <span style={{ fontSize: 14, fontWeight: 600, fontFamily: "'Nunito', sans-serif", letterSpacing: '-.3px' }}>{fmt(total)}</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  PAGE: BUDGETS
// ─────────────────────────────────────────────────────────────
function Budgets({ expenses, budgets, onEditBudgets, fmt = peso }) {
  const cats = catTotals(expenses);
  const tb = Object.values(budgets).reduce((s, v) => s + v, 0);
  let uA = 0, uN = 0, oA = 0, oN = 0;
  CATS.forEach(cat => {
    const spent = cats[cat] || 0, lim = budgets[cat] || 0;
    if (spent > lim) { oA += spent - lim; oN++; } else { uA += lim - spent; uN++; }
  });

  return (
    <div className="page-enter">
      <div className="mrow gap">
        <div className="mcard">
          <div className="mcard-lbl">Under Budget</div>
          <div className="mcard-val" style={{ color: 'var(--green)' }}>{fmt(uA)}</div>
          <div className="mcard-sub">{uN} categories</div>
        </div>
        <div className="mcard">
          <div className="mcard-lbl">Over Budget</div>
          <div className="mcard-val" style={{ color: 'var(--red)' }}>{oN > 0 ? fmt(oA) : 'None'}</div>
          <div className="mcard-sub">{oN > 0 ? `${oN} over limit` : 'All clear'}</div>
        </div>
        <div className="mcard">
          <div className="mcard-lbl">Total Limit</div>
          <div className="mcard-val">{fmt(tb)}</div>
          <div className="mcard-sub">all categories</div>
        </div>
      </div>

      <div className="card">
        <div className="card-hd">
          <span className="card-title">Category Limits</span>
          <button className="btn btn-sm" onClick={onEditBudgets}>
            <EditIcon /> Edit Limits
          </button>
        </div>
        <div className="card-body">
          {CATS.map((cat, idx) => {
            const spent = cats[cat] || 0, lim = budgets[cat] || 0;
            const noLimit = lim === 0;
            const pct = noLimit ? 0 : Math.min(100, Math.round((spent / lim) * 100));
            const over = !noLimit && spent > lim, warn = !noLimit && pct > 75 && !over;
            const isEmpty = spent === 0 && noLimit;
            const isLast = idx === CATS.length - 1;
            return (
              <div key={cat} style={{ padding: '18px 0', borderBottom: isLast ? 'none' : '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="cat-ico sm" style={{ background: getCatBg(cat), color: getCatFg(cat), borderColor: getCatFg(cat) }}><CatIcon name={cat} size={20} /></div>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{cat}</span>
                    {over && <span className="badge br">Over</span>}
                    {warn && <span className="badge ba">Warning</span>}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>
                    {fmt(spent)}<span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)' }}> / {fmt(lim)}</span>
                  </span>
                </div>
                <div className="pbar" style={isEmpty ? { opacity: 0.35 } : undefined}>
                  <div className={`pbar-fill${over ? ' over' : warn ? ' warn' : ''}${isEmpty ? ' empty' : ''}`} style={{ width: isEmpty ? '100%' : `${pct}%`, background: isEmpty ? 'var(--border)' : undefined }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink2)' }}>{pct}% used</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: over ? 'var(--red)' : 'var(--ink2)' }}>
                    {noLimit ? 'No limit set' : over ? `${fmt(spent - lim)} over` : `${fmt(lim - spent)} remaining`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  PAGE: RECURRING
// ─────────────────────────────────────────────────────────────
function Recurring({ recurring, onToggle, onDelete, onAdd, fmt = peso }) {
  const active = recurring.filter(r => r.active);
  const total = active.reduce((s, r) => s + r.amount, 0);
  const today = new Date();
  const soon = active.filter(r => {
    const d = new Date(r.due || '');
    const diff = (d - today) / 864e5;
    return !isNaN(d) && diff >= 0 && diff <= 7;
  });
  const big = [...active].sort((a, b) => b.amount - a.amount)[0];

  return (
    <div className="page-enter">
      {/* Hero stats */}
      <div className="hero-grid gap">
        <div className="hero-card">
          <div className="hlabel">Monthly Fixed Costs</div>
          <div className="hval">{fmt(total)}</div>
          <div className="hsub">{active.length} active subscriptions</div>
        </div>
        <div className="hero-card" style={{ background: soon.length ? '#E74C3C' : 'var(--ink)', borderColor: soon.length ? '#c0392b' : 'var(--ink)', transition: 'background .3s' }}>
          <div className="hlabel" style={{ color: 'rgba(255,255,255,.65)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#fff' }}>
              <AlertIcon size={11} /><span>Due Within 7 Days</span>
            </span>
          </div>
          <div className="hval" style={{ color: '#fff' }}>{soon.length}</div>
          <div className="hsub" style={{ color: 'rgba(255,255,255,.7)' }}>{soon.length ? soon.map(r => r.name).join(', ') : 'No upcoming bills'}</div>
        </div>
        <div className="hero-card" style={{ background: 'var(--ink)' }}>
          <div className="hlabel">Largest Bill</div>
          <div className="hval" style={{ fontSize: 20 }}>{big ? big.name : '—'}</div>
          <div className="hsub">{big ? `${fmt(big.amount)}/month` : ''}</div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-accent btn-sm" onClick={onAdd}><PlusIcon /> Add Recurring</button>
      </div>

      <div className="card">
        <div className="card-hd"><span className="card-title">All Subscriptions &amp; Bills</span></div>
        <div style={{ padding: '0 22px' }}>
          {recurring.map(r => (
            <div key={r.id} style={{
              display: 'grid',
              gridTemplateColumns: '44px 1fr auto auto auto',
              alignItems: 'center',
              gap: 14,
              padding: '14px 0',
              borderBottom: '1.5px solid var(--border)',
              opacity: r.active ? 1 : 0.45,
            }}>
              <div className="cat-ico" style={{ background: getCatBg(r.cat), color: getCatFg(r.cat), borderColor: getCatFg(r.cat) }}><CatIcon name={r.cat} size={22} /></div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>{r.name}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink3)', marginTop: 4 }}>{`Every month · Day ${r.day}${r.due ? ` · Due ${r.due}` : ''}`}</div>
              </div>
              <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <span style={{ fontSize: 15, fontWeight: 900, color: 'var(--ink)' }}>{fmt(r.amount)}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink3)', marginLeft: 3 }}>/mo</span>
              </div>
              <button className="btn btn-xs" onClick={() => onToggle(r.id)}>{r.active ? 'Pause' : 'Resume'}</button>
              <button className="btn btn-icon btn-ghost btn-delete" style={{ color: '#E74C3C' }} onClick={() => onDelete(r.id)}><TrashIcon size={16} /></button>
            </div>
          ))}
        </div>
        <div style={{ padding: '16px 22px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--ink3)', fontFamily: "'Nunito', sans-serif", lineHeight: 1.7 }}>
          Bill Shield — MoneyLens tracks your billing cycles and flags upcoming charges so you&apos;re never caught off guard.
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  PAGE: GOALS
// ─────────────────────────────────────────────────────────────
function Goals({ goals, onDelete, onContribute, onAdd, fmt = peso }) {
  return (
    <div className="page-enter">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn btn-accent btn-sm" onClick={onAdd}><PlusIcon /> New Goal</button>
      </div>

      {goals.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '56px 20px', color: 'var(--ink3)', fontSize: 13 }}>No savings goals yet. Create your first one.</div>
      ) : (
        <div className="goals-grid">
          {goals.map(g => {
            const pct = Math.round((g.saved / g.target) * 100);
            return (
              <div key={g.id} className="goal-card">
                <div style={{ fontSize: 15, fontWeight: 600, marginTop: 8, marginBottom: 4, letterSpacing: '-.1px' }}>{g.name}</div>
                <div style={{ fontSize: 11, color: 'var(--ink3)', fontFamily: "'Nunito', sans-serif", letterSpacing: '.1px', marginBottom: 22 }}>
                  Deadline: {g.deadline.replace('-', '/')}
                </div>
                <div style={{ fontFamily: "'Nunito', sans-serif", fontSize: 30, letterSpacing: '-.5px', lineHeight: 1 }}>{fmt(g.saved)}</div>
                <div style={{ fontSize: 11, color: 'var(--ink3)', fontFamily: "'Nunito', sans-serif", margin: '6px 0 14px' }}>of {fmt(g.target)} target</div>
                <div className="pbar"><div className="pbar-fill" style={{ width: `${pct}%` }} /></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--ink3)', fontFamily: "'Nunito', sans-serif", marginTop: 6, marginBottom: 20 }}>
                  <span>{pct}% complete</span>
                  <span>{fmt(g.target - g.saved)} remaining</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-black btn-sm" style={{ flex: 1, justifyContent: 'center' }} onClick={() => onContribute(g)}>Contribute</button>
                  <button className="btn btn-icon btn-ghost btn-sm btn-delete" style={{ color: '#E74C3C' }} onClick={() => onDelete(g.id)}><TrashIcon size={16} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  PAGE: INSIGHTS
// ─────────────────────────────────────────────────────────────
function Insights({ expenses, budgets, goals, fmt = peso }) {
  const cats = catTotals(expenses);
  const total = Object.values(cats).reduce((s, v) => s + v, 0) || 1;
  const entries = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const big = entries[0];
  const avg = Math.round(total / 15);
  const tb = Object.values(budgets).reduce((s, v) => s + v, 0);
  const sr = Math.max(0, Math.round(((tb - total) / tb) * 100));
  const tip = big ? (TIPS[big[0]] || `${big[0]} leads your spend — review sub-categories for reduction.`) : 'Add more transactions for personalised insights.';
  const over = CATS.filter(c => (cats[c] || 0) > budgets[c]);
  const safe = CATS.filter(c => (cats[c] || 0) <= budgets[c] * 0.5);

  return (
    <div className="page-enter">
      {/* Hero row */}
      <div className="hero-grid gap">
        <div className="hero-card">
          <div className="hlabel">Daily Average</div>
          <div className="hval">{fmt(avg)}</div>
          <div className="hsub">{fmt(Math.round(avg * 30))} projected</div>
        </div>
        <div className="hero-card" style={{ background: 'var(--ink)' }}>
          <div className="hlabel">Savings Rate</div>
          <div className="hval">{sr}%</div>
          <div className="hsub">of total budget</div>
        </div>
        <div className="hero-card" style={{ background: 'var(--ink)' }}>
          <div className="hlabel">Top Category</div>
          <div className="hval" style={{ fontSize: 20 }}>{big ? big[0] : '—'}</div>
          <div className="hsub">{big ? fmt(big[1]) : ''}</div>
        </div>
      </div>

      {/* Bar chart */}
      <div className="card gap">
        <div className="card-hd"><span className="card-title">Expenditure Breakdown</span></div>
        <div className="card-body">
          {entries.map(([cat, v]) => (
            <div key={cat} className="brow">
              <span className="brow-lbl">{cat}</span>
              <div className="brow-track">
                <div className="brow-fill" style={{ width: `${Math.round((v / total) * 100)}%` }} />
              </div>
              <span className="brow-val">{fmt(v)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recommendation */}
      <div className="insight-strip gap">
        <div className="istrip-ico"><InfoIcon /></div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.8px', textTransform: 'uppercase', color: 'rgba(255,255,255,.45)', marginBottom: 5 }}>Recommendation</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,.8)', lineHeight: 1.7 }}>{tip}</div>
        </div>
      </div>

      {/* Over budget */}
      {over.length > 0 && (
        <div className="card gap" style={{ borderColor: 'var(--red)' }}>
          <div className="card-hd" style={{ background: 'var(--red-bg)' }}>
            <span className="card-title" style={{ color: 'var(--red)' }}>Over Budget</span>
          </div>
          <div className="card-body">
            {over.map((c, i) => (
              <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: i < over.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div className="cat-ico sm" style={{ background: getCatBg(c), color: getCatFg(c), borderColor: getCatFg(c) }}><CatIcon name={c} size={20} /></div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{c}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink3)' }}>Limit: {fmt(budgets[c])}</div>
                </div>
                <span style={{ fontFamily: "'Nunito', sans-serif", fontSize: 12, fontWeight: 600, color: 'var(--red)' }}>+{fmt((cats[c] || 0) - budgets[c])}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Well within budget */}
      {safe.length > 0 && (
        <div className="card gap" style={{ borderColor: 'var(--green)' }}>
          <div className="card-hd" style={{ background: 'var(--green-bg)' }}>
            <span className="card-title" style={{ color: 'var(--green)' }}>Well Within Budget</span>
          </div>
          <div className="card-body" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {safe.map(c => (
              <span key={c} className="cat-pill" style={{ background: 'var(--green-bg)', borderColor: 'var(--green)', color: 'var(--green)' }}>
                <CatIcon name={c} size={16} />&nbsp;{c} {budgets[c] > 0 ? Math.round(((cats[c] || 0) / budgets[c]) * 100) : 0}%
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Goals glance */}
      <div className="card">
        <div className="card-hd"><span className="card-title">Goals at a Glance</span></div>
        <div className="card-body">
          {goals.map((g, gi) => {
            const pct = Math.round((g.saved / g.target) * 100);
            const isLast = gi === goals.length - 1;
            return (
              <div key={g.id} style={{ marginBottom: isLast ? 0 : 16, paddingBottom: isLast ? 0 : 16, borderBottom: isLast ? 'none' : '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{g.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--ink3)', fontFamily: "'Nunito', sans-serif" }}>{pct}% · {fmt(g.saved)} / {fmt(g.target)}</span>
                </div>
                <div className="pbar" style={{ height: 4 }}><div className="pbar-fill" style={{ width: `${pct}%` }} /></div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
//  PAGE: SETTINGS
// ─────────────────────────────────────────────────────────────
function Settings({ budgets, onSaveBudgets, customCats, onAddCustomCat, currency, onCurrencyChange, fmt = peso }) {
  const [form, setForm] = useState({ ...budgets });
  const [saved, setSaved] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [newLim, setNewLim] = useState('');
  useEffect(() => { setForm({ ...budgets }); }, [budgets]);

  const CURRENCIES = [
    { code: 'PHP', symbol: '₱', label: 'Philippine Peso' },
    { code: 'USD', symbol: '$', label: 'Dollar' },
    { code: 'EUR', symbol: '€', label: 'Euro' },
    { code: 'GBP', symbol: '£', label: 'British Pound' },
    { code: 'JPY', symbol: '¥', label: 'Japanese Yen' },
  ];
  const selectedCur = CURRENCIES.find(x => x.code === currency) || CURRENCIES[0];
  const saveCurrency = (code) => { onCurrencyChange(code); };

  const allCats = [...CATS, ...(customCats || [])];
  const total = allCats.reduce((s, cat) => s + (parseFloat(form[cat]) || 0), 0);

  const handleSave = () => {
    onSaveBudgets(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleAddCat = () => {
    if (!newCat.trim()) return;
    const updatedForm = { ...form, [newCat.trim()]: parseFloat(newLim) || 0 };
    setForm(updatedForm);
    onAddCustomCat(newCat.trim());
    onSaveBudgets(updatedForm);
    setNewCat(''); setNewLim('');
  };

  const CAT_DOT = {
    Food: 'var(--cat-food)', Transport: 'var(--cat-transport)', Shopping: 'var(--cat-shopping)',
    Bills: 'var(--cat-bills)', Health: 'var(--cat-health)',
  };

  return (
    <div className="page-enter">
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--ink)', marginBottom: 4 }}>Settings</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink3)' }}>Manage your budget limits and preferences</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* LEFT — Budget limits */}
        <div className="card">
          <div className="card-hd">
            <span className="card-title">Monthly Budget Limits</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--accent)' }}>Total: {fmt(total)}</span>
          </div>
          <div className="card-body" style={{ padding: '8px 20px 16px' }}>
            {/* Category rows */}
            {allCats.map((cat, idx) => {
              const isCustom = !CATS.includes(cat);
              const isLast = idx === allCats.length - 1;
              const dot = CAT_DOT[cat] || 'var(--ink3)';
              return (
                <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: isLast ? 'none' : '1.5px solid var(--border)' }}>
                  {/* Dot */}
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                  {/* Name — no wrap, takes remaining space */}
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {cat}
                    {isCustom && <span style={{ fontSize: 8, fontWeight: 800, color: 'var(--accent)', marginLeft: 5, background: 'var(--accent-bg)', padding: '1px 5px', borderRadius: 4 }}>CUSTOM</span>}
                  </div>
                  {/* Input — fixed width, pushed to right */}
                  <div style={{ position: 'relative', flexShrink: 0, width: 130 }}>
                    <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 13, fontWeight: 700, color: 'var(--ink3)', pointerEvents: 'none' }}>{selectedCur.symbol}</span>
                    <input
                      className="finput"
                      type="number" min="0"
                      style={{ paddingLeft: 24, MozAppearance: 'textfield' }}
                      value={form[cat] || ''}
                      placeholder="0"
                      onChange={e => setForm(p => ({ ...p, [cat]: e.target.value === '' ? 0 : parseFloat(e.target.value) || 0 }))}
                    />
                  </div>
                  {/* Delete — custom only */}
                  {isCustom ? (
                    <button
                      className="btn btn-icon btn-delete"
                      style={{ flexShrink: 0 }}
                      onClick={() => {
                        setForm(p => { const n = { ...p }; delete n[cat]; return n; });
                        onAddCustomCat('__delete__' + cat, 0);
                      }}
                    >
                      <TrashIcon size={15} />
                    </button>
                  ) : (
                    <div style={{ width: 38, flexShrink: 0 }} />
                  )}
                </div>
              );
            })}

            {/* Add custom category inline */}
            <div style={{ marginTop: 16, padding: '14px', background: 'var(--surface2)', borderRadius: 'var(--r2)', border: '2px dashed var(--border2)' }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.8px', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 10 }}>Add Custom Category</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <input className="finput" placeholder="Category name..." style={{ flex: '1 1 140px', minWidth: 0 }} value={newCat} onChange={e => setNewCat(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddCat()} />
                <div style={{ position: 'relative', flex: '0 0 120px' }}>
                  <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 13, fontWeight: 700, color: 'var(--ink3)', pointerEvents: 'none' }}>{selectedCur.symbol}</span>
                  <input className="finput" type="number" min="0" placeholder="Limit" style={{ paddingLeft: 24 }} value={newLim} onChange={e => setNewLim(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddCat()} />
                </div>
                <button className="btn btn-sm btn-accent" onClick={handleAddCat} style={{ whiteSpace: 'nowrap' }}><PlusIcon size={10} /> Add</button>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <button className="btn btn-accent btn-sm" onClick={handleSave}>
                {saved ? '✓ Saved!' : 'Save Budget Limits'}
              </button>
            </div>
          </div>
        </div>

        {/* Bottom row — Currency + App Info side by side */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

          {/* Currency */}
          <div className="card">
            <div className="card-hd"><span className="card-title">Currency</span></div>
            <div className="card-body" style={{ padding: '12px 20px 16px' }}>
              <div style={{ position: 'relative', marginBottom: 8 }}>
                <select
                  className="finput"
                  value={currency}
                  style={{ paddingRight: 36, appearance: 'none', WebkitAppearance: 'none' }}
                  onChange={e => saveCurrency(e.target.value)}
                >
                  {CURRENCIES.map(cur => (
                    <option key={cur.code} value={cur.code}>{cur.symbol} {cur.code} — {cur.label}</option>
                  ))}
                </select>
                <div style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--accent)' }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </div>
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink3)' }}>
                Affects all displayed amounts
              </div>
            </div>
          </div>

          {/* App Info */}
          <div className="card">
            <div className="card-hd"><span className="card-title">App Info</span></div>
            <div className="card-body" style={{ padding: '8px 20px 16px' }}>
              {[
                { label: 'App', value: 'MoneyLens' },
                { label: 'Version', value: 'v3.0' },
              ].map(({ label, value }, i, arr) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: i < arr.length - 1 ? '1.5px solid var(--border)' : 'none' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink3)' }}>{label}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  SIDEBAR NAV ITEMS CONFIG
// ─────────────────────────────────────────────────────────────
const NAV = [
  {
    id: 'dashboard', label: 'Dashboard', group: 'Overview',
    icon: <svg width="18" height="18" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" /><rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" /><rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" /><rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" /></svg>,
  },
  {
    id: 'expenses', label: 'Expenses', group: 'Overview',
    icon: <svg width="18" height="18" viewBox="0 0 14 14" fill="none"><path d="M2 3h10M2 7h7M2 11h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
  },
  {
    id: 'budgets', label: 'Budgets', group: 'Overview',
    icon: <svg width="18" height="18" viewBox="0 0 14 14" fill="none"><path d="M1.5 11V6.5l2.5-3.5 3 2.5 2.5-2.5 3 3V11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 11V8.5h4V11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  },
  {
    id: 'recurring', label: 'Recurring', group: 'Planning',
    icon: <svg width="18" height="18" viewBox="0 0 14 14" fill="none"><polyline points="1,4.5 1,1 4.5,1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /><path d="M1 1c1.5-1 6.5-1.5 9 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><polyline points="13,9.5 13,13 9.5,13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /><path d="M13 13c-1.5 1-6.5 1.5-9-2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>,
  },
  {
    id: 'goals', label: 'Goals', group: 'Planning',
    icon: <svg width="18" height="18" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" /><circle cx="7" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.2" /><circle cx="7" cy="7" r="1" fill="currentColor" /></svg>,
  },
  {
    id: 'insights', label: 'Insights', group: 'Planning',
    icon: <svg width="18" height="18" viewBox="0 0 14 14" fill="none"><path d="M1.5 11l2.5-4 2.5 1.5 2-4 3.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /><path d="M1 13h12" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" /></svg>,
  },
  {
    id: 'settings', label: 'Settings', group: 'Account',
    icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.3" /><path d="M9 1v2M9 15v2M1 9h2M15 9h2M3.2 3.2l1.4 1.4M13.4 13.4l1.4 1.4M3.2 14.8l1.4-1.4M13.4 4.6l1.4-1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
  },
];

// ─────────────────────────────────────────────────────────────
//  LOGIN PAGE
// ─────────────────────────────────────────────────────────────
function LoginPage({ onAuth }) {
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'signup') {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      const msg = err.code?.replace('auth/', '').replace(/-/g, ' ') || err.message;
      setError(msg.charAt(0).toUpperCase() + msg.slice(1));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setError('');
    setBusy(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        const msg = err.code?.replace('auth/', '').replace(/-/g, ' ') || err.message;
        setError(msg.charAt(0).toUpperCase() + msg.slice(1));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <div className="brand-logo" style={{ width: 44, height: 44, borderRadius: 14 }}>
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
                <path d="M2 12l3-5.5 3 3 3-4.5 3 5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="13.5" cy="3.5" r="1.5" fill="rgba(255,255,255,.5)" />
              </svg>
            </div>
            <span style={{ fontSize: 26, fontWeight: 900, color: 'var(--ink)', letterSpacing: '-.5px' }}>MoneyLens</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink3)' }}>Track every peso. Own every decision.</div>
        </div>

        {/* Error */}
        {error && <div className="auth-error"><AlertIcon size={14} /> {error}</div>}

        {/* Email form */}
        <form onSubmit={handleSubmit}>
          <Field label="Email">
            <input
              className="finput" type="email" placeholder="you@email.com"
              value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email"
            />
          </Field>
          <Field label="Password">
            <input
              className="finput" type="password" placeholder="••••••••"
              value={password} onChange={e => setPassword(e.target.value)} required
              minLength={6} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
          </Field>
          <button className="btn btn-accent" type="submit" disabled={busy}
            style={{ width: '100%', justifyContent: 'center', padding: '12px 18px' }}>
            {busy ? '...' : mode === 'signup' ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        {/* Divider */}
        <div className="auth-divider"><span>or</span></div>

        {/* Google */}
        <button className="google-btn" onClick={handleGoogle} disabled={busy} type="button">
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59A14.5 14.5 0 019.5 24c0-1.59.28-3.14.76-4.59l-7.98-6.19A23.94 23.94 0 000 24c0 3.77.9 7.34 2.44 10.50l8.09-5.91z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          Continue with Google
        </button>

        {/* Toggle */}
        <div className="auth-toggle">
          {mode === 'signin' ? (
            <>Don't have an account? <button type="button" onClick={() => { setMode('signup'); setError(''); }}>Sign Up</button></>
          ) : (
            <>Already have an account? <button type="button" onClick={() => { setMode('signin'); setError(''); }}>Sign In</button></>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  ROOT APP
// ─────────────────────────────────────────────────────────────
export default function App() {
  // ── Auth state ─────────────────────────────────────────────
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u ?? null));
    return unsub;
  }, []);

  // ── State ──────────────────────────────────────────────────
  const [page, setPage] = useState('dashboard');
  const [expenses, setExpenses] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [goals, setGoals] = useState([]);
  const [budgets, setBudgets] = useState(DEFAULT_BUDGETS);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [modalData, setModalData] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [customCats, setCustomCats] = useState([]);
  const [addCatOpen, setAddCatOpen] = useState(false);
  const [currency, setCurrency] = useState(() => localStorage.getItem('ml_currency') || 'PHP');
  const toast = useToast();

  const handleSignOut = async () => {
    try { await firebaseSignOut(auth); } catch (err) { console.error('Sign-out error:', err); }
  };

  const CURRENCY_SYMBOLS = { PHP: '₱', USD: '$', EUR: '€', GBP: '£', JPY: '¥', SGD: 'S$', AUD: 'A$', CAD: 'C$' };
  const currSymbol = CURRENCY_SYMBOLS[currency] || '₱';
  // currSymbol and fmt are passed to all pages/modals
  const fmt = (n) => currSymbol + Math.round(n).toLocaleString('en-PH');

  // ── Per-user Firestore path helpers ─────────────────────────
  const uid = user?.uid;
  const userCol = useCallback((name) => collection(db, 'users', uid, name), [uid]);
  const userDoc = useCallback((col, id) => doc(db, 'users', uid, col, id), [uid]);

  // ── Firebase listeners (per-user) ──────────────────────────
  useEffect(() => {
    if (!uid) { setLoading(false); return; }
    setLoading(true);
    const unsubExpenses = onSnapshot(
      query(userCol('expenses'), orderBy('createdAt', 'desc')),
      (snap) => {
        setExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => { console.error('Firestore expenses error:', err); setLoading(false); }
    );
    const unsubRecurring = onSnapshot(
      userCol('recurring'),
      (snap) => setRecurring(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      (err) => { console.error('Firestore recurring error:', err); setRecurring([]); }
    );
    const unsubGoals = onSnapshot(
      userCol('goals'),
      (snap) => setGoals(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      (err) => { console.error('Firestore goals error:', err); setGoals([]); }
    );
    const unsubBudgets = onSnapshot(
      doc(db, 'users', uid, 'config', 'budgets'),
      (snap) => { if (snap.exists()) setBudgets(snap.data()); },
      () => { }
    );
    return () => { unsubExpenses(); unsubRecurring(); unsubGoals(); unsubBudgets(); };
  }, [uid, userCol]);

  const openModal = (type, data = null) => { setModal(type); setModalData(data); };
  const closeModal = () => { setModal(null); setModalData(null); };

  // ── Expense handlers ───────────────────────────────────────
  const addExpense = async (form) => {
    try {
      await addDoc(userCol('expenses'), { ...form, createdAt: serverTimestamp() });
      closeModal();
      toast.show('Transaction recorded');
    } catch (err) {
      console.error('addExpense error:', err);
      setExpenses(prev => [{ id: Date.now().toString(), ...form }, ...prev]);
      closeModal();
      toast.show('Saved locally - check Firestore rules');
    }
  };
  const deleteExpense = async (id) => {
    try {
      await deleteDoc(userDoc('expenses', id));
    } catch {
      setExpenses(prev => prev.filter(e => e.id !== id));
    }
    toast.show('Removed');
  };
  const confirmDeleteExpense = (id) => {
    const item = expenses.find(e => e.id === id);
    setConfirmDel({ id, name: item?.name || 'this expense', type: 'expense' });
  };

  // ── Budget handlers ────────────────────────────────────────
  const saveBudgets = async (newBudgets) => {
    setBudgets(newBudgets);
    try {
      await setDoc(doc(db, 'users', uid, 'config', 'budgets'), newBudgets);
    } catch {
      // already updated locally above
    }
    if (modal) closeModal();
    toast.show('Budgets updated');
  };

  // ── Recurring handlers ─────────────────────────────────────
  const addRecurring = async (form) => {
    try {
      await addDoc(userCol('recurring'), { ...form, active: true, createdAt: serverTimestamp() });
      closeModal();
      toast.show('Recurring bill added');
    } catch {
      setRecurring(prev => [...prev, { id: Date.now().toString(), active: true, ...form }]);
      closeModal();
      toast.show('Saved locally');
    }
  };
  const toggleRecurring = async (id) => {
    const r = recurring.find(r => r.id === id);
    if (!r) return;
    try {
      await updateDoc(userDoc('recurring', id), { active: !r.active });
    } catch {
      setRecurring(prev => prev.map(r => r.id === id ? { ...r, active: !r.active } : r));
    }
  };
  const deleteRecurring = async (id) => {
    try {
      await deleteDoc(userDoc('recurring', id));
    } catch {
      setRecurring(prev => prev.filter(r => r.id !== id));
    }
    toast.show('Removed');
  };
  const confirmDeleteRecurring = (id) => {
    const item = recurring.find(r => r.id === id);
    setConfirmDel({ id, name: item?.name || 'this bill', type: 'recurring' });
  };

  // ── Goal handlers ──────────────────────────────────────────
  const addGoal = async (form) => {
    try {
      await addDoc(userCol('goals'), { ...form, createdAt: serverTimestamp() });
      closeModal();
      toast.show('Goal created');
    } catch {
      setGoals(prev => [...prev, { id: Date.now().toString(), ...form }]);
      closeModal();
      toast.show('Saved locally');
    }
  };
  const deleteGoal = async (id) => {
    try {
      await deleteDoc(userDoc('goals', id));
    } catch {
      setGoals(prev => prev.filter(g => g.id !== id));
    }
    toast.show('Goal removed');
  };
  const confirmDeleteGoal = (id) => {
    const item = goals.find(g => g.id === id);
    setConfirmDel({ id, name: item?.name || 'this goal', type: 'goal' });
  };
  const contribute = async (id, amount) => {
    const g = goals.find(g => g.id === id);
    if (!g) return;
    const newSaved = Math.min(g.target, g.saved + amount);
    try {
      await updateDoc(userDoc('goals', id), { saved: newSaved });
    } catch {
      setGoals(prev => prev.map(g => g.id === id ? { ...g, saved: newSaved } : g));
    }
    closeModal();
    toast.show(`${fmt(amount)} added`);
  };

  // ── Date header ────────────────────────────────────────────
  const dateStr = new Date().toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });

  // ── Auth gate — show login page when not signed in ─────────
  if (user === undefined || (user && loading)) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: 'var(--bg)', flexDirection: 'column', gap: 20,
        fontFamily: "'Nunito', sans-serif",
      }}>
        <div style={{ fontSize: 14, color: 'var(--accent)', textShadow: '2px 2px 0 rgba(0,0,0,.5)', letterSpacing: 2, animation: 'fadein .5s steps(4) infinite alternate' }}>
          LOADING...
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{
              width: 12, height: 12, background: 'var(--accent)',
              opacity: 0.3, border: '2px solid var(--accent)',
              animation: `pdot 1s steps(2) ${i * 0.2}s infinite`,
            }} />
          ))}
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <>
      <div className="shell">
        {/* TOPBAR */}
        <header className="topbar">
          <div className="topbar-brand">
            {/* Hamburger — mobile only */}
            <button className="hamburger" onClick={() => setMenuOpen(o => !o)} aria-label="Menu">
              <span /><span /><span />
            </button>
            <div className="brand-logo">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 12l3-5.5 3 3 3-4.5 3 5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="13.5" cy="3.5" r="1.5" fill="rgba(255,255,255,.5)" />
              </svg>
            </div>
            <span className="brand-name">MoneyLens</span>
          </div>
          <div className="topbar-center">
            <div className="pulse-dot" />
            Financial Pulse — Active
            <span style={{ color: 'var(--ink3)' }}>·</span>
            <span style={{ color: 'var(--ink3)' }}>{dateStr}</span>
          </div>
          <div className="topbar-right">
            <button className="btn btn-accent btn-sm" onClick={() => openModal('add-expense')}>
              <PlusIcon /> <span className="hide-sm">Add Expense</span>
            </button>
            <button className="btn btn-sm btn-ghost" onClick={handleSignOut} title="Sign Out" style={{ gap: 5 }}>
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M7 17H4a1 1 0 01-1-1V4a1 1 0 011-1h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M14 14l4-4-4-4M8 10h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <span className="hide-sm">Sign Out</span>
            </button>
          </div>
        </header>

        {/* MOBILE DRAWER OVERLAY */}
        {menuOpen && (
          <div className="drawer-overlay" onClick={() => setMenuOpen(false)} />
        )}

        {/* SIDEBAR / MOBILE DRAWER */}
        <aside className={`sidebar${menuOpen ? ' drawer-open' : ''}`}>
          {/* Drawer header on mobile */}
          <div className="drawer-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="brand-logo" style={{ width: 28, height: 28 }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M2 12l3-5.5 3 3 3-4.5 3 5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="13.5" cy="3.5" r="1.5" fill="rgba(255,255,255,.5)" />
                </svg>
              </div>
              <span className="brand-name" style={{ fontSize: 14 }}>MoneyLens</span>
            </div>
            <button className="btn btn-icon btn-ghost drawer-close" onClick={() => setMenuOpen(false)}>
              <CloseIcon size={14} />
            </button>
          </div>
          {['Overview', 'Planning', 'Account'].map(group => (
            <div key={group}>
              <div className="ngl">{group}</div>
              {NAV.filter(n => n.group === group).map(n => (
                <button key={n.id} className={`nav-item${page === n.id ? ' active' : ''}`} onClick={() => { setPage(n.id); setMenuOpen(false); }}>
                  {n.icon}{n.label}
                </button>
              ))}
            </div>
          ))}
          <div className="sspacer" />
          <div className="sfoot">
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4, textAlign: 'center' }}>
              {user.email || 'Signed in'}
            </div>
            <button className="btn btn-sm btn-ghost" onClick={handleSignOut} style={{ width: '100%', justifyContent: 'center', fontSize: 11, padding: '6px 10px', gap: 5 }}>
              <svg width="13" height="13" viewBox="0 0 20 20" fill="none"><path d="M7 17H4a1 1 0 01-1-1V4a1 1 0 011-1h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M14 14l4-4-4-4M8 10h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Sign Out
            </button>
          </div>
        </aside>

        {/* MAIN CONTENT */}
        <main className="main">
          {page === 'dashboard' && (
            <>
              {/* First-use tutorial — shown when user has no data yet */}
              {expenses.length === 0 && recurring.length === 0 && goals.length === 0 && (
                <div className="card gap page-enter" style={{ borderColor: 'var(--accent)', borderWidth: 2.5 }}>
                  <div className="card-hd" style={{ background: 'var(--accent)', borderColor: 'var(--accent)' }}>
                    <span className="card-title" style={{ color: '#fff', fontSize: 16 }}>Hi {(user.displayName || user.email || '').split(/[\s@]/)[0] || 'there'}. Welcome to MoneyLens!</span>
                  </div>
                  <div className="card-body" style={{ padding: '24px 22px' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginBottom: 16, lineHeight: 1.7 }}>
                      Get started in 3 easy steps:
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {[
                        { step: '1', title: 'Record your first expense', desc: 'Tap the "Add Expense" button in the top bar to log a transaction.', action: () => openModal('add-expense'), btn: 'Add Expense', color: '#3498DB' },
                        { step: '2', title: 'Set your budget limits', desc: 'Go to Settings to define monthly spending limits per category.', action: () => setPage('settings'), btn: 'Open Settings', color: '#2ECC71' },
                        { step: '3', title: 'Track recurring bills', desc: 'Add bills like rent, subscriptions, and utilities to stay on top of due dates.', action: () => { setPage('recurring'); }, btn: 'View Recurring', color: '#9B59B6' },
                      ].map(s => (
                        <div key={s.step} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: 10,
                            background: s.color, color: '#fff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 14, fontWeight: 900, flexShrink: 0,
                            border: '2px solid var(--ink)', boxShadow: '2px 2px 0 var(--ink)',
                          }}>{s.step}</div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)', marginBottom: 3 }}>{s.title}</div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink3)', lineHeight: 1.6, marginBottom: 8 }}>{s.desc}</div>
                            <button className="btn btn-sm btn-accent" onClick={s.action}>{s.btn}</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

              )}
              <Dashboard
                key="dashboard"
                expenses={expenses}
                recurring={recurring}
                goals={goals}
                budgets={budgets}
                onNav={setPage}
                onAddExpense={() => openModal('add-expense')}
                fmt={fmt}
              />
            </>
          )}
          {page === 'expenses' && (
            <Expenses key="expenses" expenses={expenses} onDelete={confirmDeleteExpense} fmt={fmt} />
          )}
          {page === 'budgets' && (
            <Budgets key="budgets" expenses={expenses} budgets={budgets} onEditBudgets={() => openModal('edit-budgets')} fmt={fmt} />
          )}
          {page === 'recurring' && (
            <Recurring
              key="recurring"
              recurring={recurring}
              onToggle={toggleRecurring}
              onDelete={confirmDeleteRecurring}
              onAdd={() => openModal('add-recurring')}
              fmt={fmt}
            />
          )}
          {page === 'goals' && (
            <Goals
              key="goals"
              goals={goals}
              onDelete={confirmDeleteGoal}
              onContribute={(g) => openModal('contribute', g)}
              onAdd={() => openModal('add-goal')}
              fmt={fmt}
            />
          )}
          {page === 'insights' && (
            <Insights key="insights" expenses={expenses} budgets={budgets} goals={goals} fmt={fmt} />
          )}
          {page === 'settings' && (
            <Settings key="settings" budgets={budgets} onSaveBudgets={saveBudgets} customCats={customCats} currency={currency} onCurrencyChange={(code) => { setCurrency(code); localStorage.setItem('ml_currency', code); }} fmt={fmt} onAddCustomCat={(name) => { if (name.startsWith('__delete__')) { const cat = name.replace('__delete__', ''); setCustomCats(p => p.filter(c => c !== cat)); const nb = { ...budgets }; delete nb[cat]; saveBudgets(nb); toast.show(cat + ' category removed'); } else { setCustomCats(p => [...p, name]); toast.show(name + ' category added'); } }} />
          )}
        </main>
      </div>

      {/* ── MODALS ─────────────────────────────────────────── */}
      <ConfirmDelete
        open={!!confirmDel}
        itemName={confirmDel?.name}
        onCancel={() => setConfirmDel(null)}
        onConfirm={async () => {
          if (!confirmDel) return;
          if (confirmDel.type === 'expense') await deleteExpense(confirmDel.id);
          if (confirmDel.type === 'recurring') await deleteRecurring(confirmDel.id);
          if (confirmDel.type === 'goal') await deleteGoal(confirmDel.id);
          setConfirmDel(null);
        }}
      />
      <AddCategoryModal open={addCatOpen} onClose={() => setAddCatOpen(false)} currSymbol={currSymbol} onSave={async (name, limit) => { setCustomCats(p => [...p, name]); if (limit > 0) { const nb = { ...budgets, [name]: limit }; setBudgets(nb); try { await setDoc(doc(db, 'users', uid, 'config', 'budgets'), nb); } catch { } } setAddCatOpen(false); toast.show(name + ' category added'); }} />
      <AddExpenseModal open={modal === 'add-expense'} onClose={closeModal} onSave={addExpense} customCats={customCats} onAddCat={() => setAddCatOpen(true)} currSymbol={currSymbol} />
      <EditBudgetsModal open={modal === 'edit-budgets'} onClose={closeModal} budgets={budgets} onSave={saveBudgets} currSymbol={currSymbol} />
      <AddRecurringModal open={modal === 'add-recurring'} onClose={closeModal} onSave={addRecurring} customCats={customCats} onAddCat={() => setAddCatOpen(true)} currSymbol={currSymbol} />
      <AddGoalModal open={modal === 'add-goal'} onClose={closeModal} onSave={addGoal} currSymbol={currSymbol} />
      <ContributeModal open={modal === 'contribute'} onClose={closeModal} goal={modalData} onSave={contribute} fmt={fmt} currSymbol={currSymbol} />

      {/* TOAST */}
      <div className={`toast${toast.visible ? ' show' : ''}`}>{toast.msg}</div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
//  CATEGORY SELECT — dropdown arrow + add custom option
// ─────────────────────────────────────────────────────────────
function CategorySelect({ value, onChange, customCats, onAddCat }) {
  const allCats = [...CATS, ...(customCats || [])];
  return (
    <div style={{ position: 'relative' }}>
      <select
        className="finput"
        value={value}
        style={{ paddingRight: 36, appearance: 'none', WebkitAppearance: 'none' }}
        onChange={e => {
          if (e.target.value === '__add__') { onAddCat && onAddCat(); }
          else onChange(e.target.value);
        }}
      >
        {allCats.map(cat => <option key={cat} value={cat}>{cat}</option>)}
        <option value="__add__">+ Add custom category...</option>
      </select>
      <div style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--accent)' }}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  MODAL: ADD CUSTOM CATEGORY
// ─────────────────────────────────────────────────────────────
function AddCategoryModal({ open, onClose, onSave, currSymbol = "₱" }) {
  const [name, setName] = useState('');
  const [limit, setLimit] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) setBusy(false); }, [open]);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try { await onSave(name.trim(), parseFloat(limit) || 0); setName(''); setLimit(''); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} title="New Category" onClose={busy ? undefined : onClose} overlayClass="on-top">
      <Field label="Category Name">
        <input
          className="finput"
          placeholder="e.g. Pets, Hobbies, Rent..."
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && save()}
          disabled={busy}
        />
      </Field>
      <Field label={`Monthly Budget Limit (${currSymbol})`}>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontSize: 13, fontWeight: 700, color: 'var(--ink3)', pointerEvents: 'none' }}>{currSymbol}</span>
          <input
            className="finput"
            type="number"
            min="0"
            placeholder="0"
            style={{ paddingLeft: 26 }}
            value={limit}
            onChange={e => setLimit(e.target.value)}
            disabled={busy}
          />
        </div>
      </Field>
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-accent" style={{ flex: 1, justifyContent: 'center', opacity: busy ? 0.75 : 1, boxShadow: busy ? 'none' : undefined }} onClick={save} disabled={busy}>
          {busy ? <><Spinner size={13} /> Saving…</> : 'Add Category'}
        </button>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
//  MODAL: ADD EXPENSE
// ─────────────────────────────────────────────────────────────
function AddExpenseModal({ open, onClose, onSave, customCats, onAddCat, currSymbol = "₱" }) {
  const [form, setForm] = useState({ name: '', amount: '', date: new Date().toISOString().slice(0, 10), cat: 'Food', note: '' });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  useEffect(() => { if (!open) setBusy(false); }, [open]);

  const handleSave = async () => {
    if (!form.name.trim() || !form.amount || !form.date) return;
    setBusy(true);
    try {
      await onSave({ name: form.name.trim(), amount: parseFloat(form.amount), date: form.date, cat: form.cat, note: form.note.trim() });
      setForm({ name: '', amount: '', date: new Date().toISOString().slice(0, 10), cat: 'Food', note: '' });
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} title="Record Expense" onClose={busy ? undefined : onClose}>
      <Field label="Description">
        <input className="finput" placeholder="e.g. Jollibee lunch" value={form.name} onChange={e => set('name', e.target.value)} disabled={busy} />
      </Field>
      <div className="g2">
        <Field label={`Amount (${currSymbol})`}>
          <input className="finput" type="number" placeholder="0" min="1" value={form.amount} onChange={e => set('amount', e.target.value)} disabled={busy} />
        </Field>
        <Field label="Date">
          <input className="finput" type="date" value={form.date} onChange={e => set('date', e.target.value)} disabled={busy} />
        </Field>
      </div>
      <Field label="Category">
        <CategorySelect value={form.cat} onChange={v => set('cat', v)} customCats={customCats} onAddCat={onAddCat} />
      </Field>
      <Field label="Note (optional)">
        <input className="finput" placeholder="Optional" value={form.note} onChange={e => set('note', e.target.value)} disabled={busy} />
      </Field>
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button className="btn" style={{ flex: 1, justifyContent: 'center', borderRadius: 'var(--r2)' }} onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-accent" style={{ flex: 1, justifyContent: 'center', opacity: busy ? 0.75 : 1, boxShadow: busy ? 'none' : undefined }} onClick={handleSave} disabled={busy}>
          {busy ? <><Spinner size={13} /> Saving…</> : 'Record'}
        </button>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
//  MODAL: EDIT BUDGETS
// ─────────────────────────────────────────────────────────────
function EditBudgetsModal({ open, onClose, budgets, onSave, currSymbol = "₱" }) {
  const [form, setForm] = useState({ ...budgets });
  const [busy, setBusy] = useState(false);
  useEffect(() => { setForm({ ...budgets }); }, [budgets, open]);
  useEffect(() => { if (!open) setBusy(false); }, [open]);

  const handleSave = async () => {
    setBusy(true);
    try { await onSave(form); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} title="Edit Budget Limits" onClose={busy ? undefined : onClose}>
      {CATS.map(c => (
        <Field key={c} label={c}>
          <input className="finput" type="number" min="0" value={form[c] || 0} onChange={e => setForm(p => ({ ...p, [c]: parseFloat(e.target.value) || 0 }))} disabled={busy} />
        </Field>
      ))}
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button className="btn" style={{ flex: 1, justifyContent: 'center', borderRadius: 'var(--r2)' }} onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-accent" style={{ flex: 1, justifyContent: 'center', opacity: busy ? 0.75 : 1, boxShadow: busy ? 'none' : undefined }} onClick={handleSave} disabled={busy}>
          {busy ? <><Spinner size={13} /> Saving…</> : 'Save Changes'}
        </button>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
//  MODAL: ADD RECURRING
// ─────────────────────────────────────────────────────────────
function AddRecurringModal({ open, onClose, onSave, customCats, onAddCat, currSymbol = "₱" }) {
  const [form, setForm] = useState({ name: '', amount: '', day: '1', cat: 'Bills', due: '' });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  useEffect(() => { if (!open) setBusy(false); }, [open]);

  const handleSave = async () => {
    if (!form.name.trim() || !form.amount) return;
    setBusy(true);
    try {
      await onSave({ name: form.name.trim(), amount: parseFloat(form.amount), day: parseInt(form.day) || 1, cat: form.cat, due: form.due });
      setForm({ name: '', amount: '', day: '1', cat: 'Bills', due: '' });
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} title="Add Recurring Bill" onClose={busy ? undefined : onClose}>
      <Field label="Name">
        <input className="finput" placeholder="e.g. Spotify Premium" value={form.name} onChange={e => set('name', e.target.value)} disabled={busy} />
      </Field>
      <div className="g2">
        <Field label={`Amount (${currSymbol})`}>
          <input className="finput" type="number" placeholder="0" value={form.amount} onChange={e => set('amount', e.target.value)} disabled={busy} />
        </Field>
        <Field label="Billing Day">
          <input className="finput" type="number" min="1" max="31" value={form.day} onChange={e => set('day', e.target.value)} disabled={busy} />
        </Field>
      </div>
      <div className="g2">
        <Field label="Category">
          <CategorySelect value={form.cat} onChange={v => set('cat', v)} customCats={customCats} onAddCat={onAddCat} />
        </Field>
        <Field label="Next Due Date">
          <input className="finput" type="date" value={form.due} onChange={e => set('due', e.target.value)} disabled={busy} />
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button className="btn" style={{ flex: 1, justifyContent: 'center', borderRadius: 'var(--r2)' }} onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-accent" style={{ flex: 1, justifyContent: 'center', opacity: busy ? 0.75 : 1, boxShadow: busy ? 'none' : undefined }} onClick={handleSave} disabled={busy}>
          {busy ? <><Spinner size={13} /> Saving…</> : 'Add'}
        </button>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
//  MODAL: ADD GOAL
// ─────────────────────────────────────────────────────────────
function AddGoalModal({ open, onClose, onSave, currSymbol = "₱" }) {
  const [form, setForm] = useState({ name: '', target: '', saved: '0', deadline: '2025-12' });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  useEffect(() => { if (!open) setBusy(false); }, [open]);

  const handleSave = async () => {
    if (!form.name.trim() || !form.target) return;
    setBusy(true);
    try {
      await onSave({ name: form.name.trim(), target: parseFloat(form.target), saved: parseFloat(form.saved) || 0, deadline: form.deadline });
      setForm({ name: '', target: '', saved: '0', deadline: '2025-12' });
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} title="New Savings Goal" onClose={busy ? undefined : onClose}>
      <Field label="Goal Name">
        <input className="finput" placeholder="e.g. Emergency Fund" value={form.name} onChange={e => set('name', e.target.value)} disabled={busy} />
      </Field>
      <div className="g2">
        <Field label={`Target (${currSymbol})`}>
          <input className="finput" type="number" placeholder="50000" value={form.target} onChange={e => set('target', e.target.value)} disabled={busy} />
        </Field>
        <Field label="Deadline">
          <input className="finput" type="month" value={form.deadline} onChange={e => set('deadline', e.target.value)} disabled={busy} />
        </Field>
      </div>
      <Field label={`Already Saved (${currSymbol})`}>
        <input className="finput" type="number" placeholder="0" value={form.saved} onChange={e => set('saved', e.target.value)} disabled={busy} />
      </Field>
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button className="btn" style={{ flex: 1, justifyContent: 'center', borderRadius: 'var(--r2)' }} onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-accent" style={{ flex: 1, justifyContent: 'center', opacity: busy ? 0.75 : 1, boxShadow: busy ? 'none' : undefined }} onClick={handleSave} disabled={busy}>
          {busy ? <><Spinner size={13} /> Saving…</> : 'Create'}
        </button>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
//  MODAL: CONTRIBUTE TO GOAL
// ─────────────────────────────────────────────────────────────
function ContributeModal({ open, onClose, goal, onSave, fmt = peso, currSymbol = "₱" }) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) { setAmount(''); setBusy(false); } }, [open]);

  const handleSave = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return;
    setBusy(true);
    try { await onSave(goal.id, amt); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} title="Contribute to Goal" onClose={busy ? undefined : onClose}>
      {goal && (
        <div style={{ background: 'var(--accent)', borderRadius: 'var(--r)', border: '2.5px solid var(--ink)', padding: '18px 20px', marginBottom: 20, boxShadow: '3px 3px 0 var(--ink)' }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: '#fff' }}>{goal.name}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,.85)', marginTop: 5 }}>
            {fmt(goal.saved)} saved of {fmt(goal.target)}
          </div>
        </div>
      )}
      <Field label={`Amount to Contribute (${currSymbol})`}>
        <input className="finput" type="number" placeholder="0" min="1" value={amount} onChange={e => setAmount(e.target.value)} disabled={busy} />
      </Field>
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button className="btn" style={{ flex: 1, justifyContent: 'center', borderRadius: 'var(--r2)' }} onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-accent" style={{ flex: 1, justifyContent: 'center', opacity: busy ? 0.75 : 1, boxShadow: busy ? 'none' : undefined }} onClick={handleSave} disabled={busy}>
          {busy ? <><Spinner size={13} /> Saving…</> : 'Confirm'}
        </button>
      </div>
    </Modal>
  );
}