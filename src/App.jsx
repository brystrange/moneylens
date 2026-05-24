// src/App.jsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
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


// ── Ordinal suffix helper ─────────────────────────────────────
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ── Shared payout palette ────────────────────────────────────
const PAYOUT_BLUE = '#2980B9';   // 1st Payout of the month
const PAYOUT_VIOLET = '#8E44AD';   // 2nd Payout of the month
const PAYOUT_RED = '#E74C3C';      // Past due / unfunded from prior cycle
const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtPayDate = (d) => `${MONTH_NAMES_SHORT[d.getMonth()]} ${ordinal(d.getDate())}`;

// ── Payout assignment engine ──────────────────────────────────
// Pre-funding rule: the payout that covers a bill is the one that
// falls immediately BEFORE the bill's due date. Money must be set
// aside from that payout so it is ready when the bill comes due.
function getPayoutAssignment(billDay, schedule, dueDate) {
  if (!schedule?.cycle || !billDay) return null;
  const { cycle } = schedule;



  if (cycle === 'bi-weekly') {
    const sorted = [...(schedule.dates || [15, 30])].sort((a, b) => a - b);
    const [d1, d2] = sorted;

    if (dueDate) {
      // Pre-funding: find the payout date STRICTLY BEFORE the due date.
      // That is the payout responsible for covering this bill.
      const due = new Date(dueDate + 'T00:00:00');
      const y = due.getFullYear();
      const m = due.getMonth();
      // Four candidates spanning two months to correctly handle early-month due dates.
      const candidates = [
        new Date(y, m - 1, d1),
        new Date(y, m - 1, d2),
        new Date(y, m, d1),
        new Date(y, m, d2),
      ].filter(d => d < due).sort((a, b) => b - a); // strictly before — pre-funding
      const assigned = candidates[0];
      if (!assigned) return { label: `Past Due`, color: PAYOUT_RED, note: 'Allocate from prior cycle' };
      return {
        label: fmtPayDate(assigned),
        color: assigned.getDate() === d2 ? PAYOUT_VIOLET : PAYOUT_BLUE,
        note: `Pre-fund from ${fmtPayDate(assigned)} payout`,
      };
    }

    // Day-only fallback (Settings preview uses synthetic bill days with no real due date).
    // 1st payout (d1) covers bills due in (d1, d2]  → e.g. days 16–30
    // 2nd payout (d2) covers bills due in (d2, d1]  → e.g. days 1–15 and 31+
    if (billDay > d1 && billDay <= d2) {
      return { label: `1st Payout — ${ordinal(d1)}`, color: PAYOUT_BLUE, note: `Pre-fund from ${ordinal(d1)} payout` };
    }
    return { label: `Prev. 2nd Payout — ${ordinal(d2)}`, color: PAYOUT_RED, note: `Due on/before ${ordinal(d1)} — pre-fund from prior ${ordinal(d2)} payout` };
  }

  if (cycle === 'monthly') {
    const d = schedule.date || 30;
    // For monthly, compute the actual preceding payout date
    if (dueDate) {
      const due = new Date(dueDate + 'T00:00:00');
      const y = due.getFullYear();
      const m = due.getMonth();
      const candidates = [
        new Date(y, m - 1, d),
        new Date(y, m, d),
      ].filter(c => c < due).sort((a, b) => b - a);
      const assigned = candidates[0];
      if (assigned) return { label: fmtPayDate(assigned), color: '#16A085', note: `Pre-fund from ${fmtPayDate(assigned)} payout` };
    }
    return { label: `Monthly — ${ordinal(d)}`, color: '#16A085', note: `Pre-fund from ${ordinal(d)} payout` };
  }



  return null;
}

// ── Next-two-cycles projection engine ────────────────────────
// Returns an array of up to 2 upcoming payout cycle objects,
// each containing which bills are due, how many are paid, totals etc.
function computeNextTwoCycles(schedule, today, activeBills) {
  if (!schedule?.cycle) return [];

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = n => String(n).padStart(2, '0');
  const mkKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const { cycle } = schedule;

  // ── 1. Determine next two payout dates ──────────────────────
  const upcoming = [];



  if (cycle === 'bi-weekly') {
    const [d1, d2] = [...(schedule.dates || [15, 30])].sort((a, b) => a - b);
    let y = today.getFullYear(), m = today.getMonth();
    for (let tries = 0; upcoming.length < 2 && tries < 6; tries++) {
      for (const day of [d1, d2]) {
        const candidate = new Date(y, m, day);
        if (candidate > today) {
          upcoming.push({ date: candidate, dateLabel: `${MONTH_NAMES[m]} ${ordinal(day)}`, cycleType: day === d1 ? 'first' : 'second', payDay: day });
          if (upcoming.length >= 2) break;
        }
      }
      m++;
      if (m >= 12) { m = 0; y++; }
    }
    upcoming.sort((a, b) => a.date - b.date);
  }

  if (cycle === 'monthly') {
    const d = schedule.date || 30;
    let y = today.getFullYear(), m = today.getMonth();
    while (upcoming.length < 2) {
      const candidate = new Date(y, m, d);
      if (candidate > today) upcoming.push({ date: candidate, dateLabel: `${MONTH_NAMES[m]} ${ordinal(d)}`, cycleType: 'monthly' });
      m++;
      if (m >= 12) { m = 0; y++; }
    }
  }



  // ── 2. Assign bills to each cycle and compute totals ────────
  return upcoming.slice(0, 2).map((payout, idx) => {
    const mk = mkKey(payout.date);
    let cycleBills;

    if (cycle === 'bi-weekly') {
      const [d1, d2] = [...(schedule.dates || [15, 30])].sort((a, b) => a - b);
      if (payout.cycleType === 'first') {
        // Pre-funding: 1st payout (d1) covers bills due in (d1, d2] — e.g. days 16–30.
        // Money received on the 15th must be set aside for bills due 16th through 30th.
        cycleBills = activeBills.filter(r => r.day > d1 && r.day <= d2);
      } else {
        // Pre-funding: 2nd payout (d2) covers bills due in (d2, d1_next] — e.g. days 1–15.
        // Money received on the 30th must be set aside for bills due 1st through 15th next month.
        cycleBills = activeBills.filter(r => r.day <= d1 || r.day > d2);
      }
    } else {
      // Monthly: all bills in every cycle
      cycleBills = activeBills;
    }

    const isPaidForCycle = r => !!(r.paidMonths?.includes(mk));
    const unpaid = cycleBills.filter(r => !isPaidForCycle(r));
    const paid = cycleBills.filter(r => isPaidForCycle(r));
    // Normalize both dates to midnight so daysUntil counts full calendar days
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const payoutMidnight = new Date(payout.date.getFullYear(), payout.date.getMonth(), payout.date.getDate());
    const daysUntil = Math.round((payoutMidnight - todayMidnight) / 864e5);

    return {
      idx,
      label: idx === 0 ? 'Next Payout' : '2nd Upcoming',
      dateLabel: payout.dateLabel,
      daysUntil,
      cycleType: payout.cycleType,
      monthKey: mk,
      bills: cycleBills,
      unpaid,
      paid,
      total: unpaid.reduce((s, r) => s + r.amount, 0),
      paidTotal: paid.reduce((s, r) => s + r.amount, 0),
      totalAll: cycleBills.reduce((s, r) => s + r.amount, 0),
    };
  });
}

// ─────────────────────────────────────────────────────────────
//  DEFAULT DATA — Firebase is the source of truth
// ─────────────────────────────────────────────────────────────
const DEFAULT_BUDGETS = {};

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
          <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{itemName}</span> will be permanently deleted.
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
          <button className="btn btn-ghost btn-sm" onClick={() => onNav('expenses')}>All <b>🡢</b></button>
        </div>
        <div style={{ padding: '0 22px' }}>
          {recent.map((e, i) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 0', borderBottom: i < recent.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <div className="cat-ico" style={{ background: getCatBg(e.cat), color: getCatFg(e.cat), borderColor: getCatFg(e.cat) }}><CatIcon name={e.cat} size={22} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</div>
                <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2, fontFamily: "'Inter', sans-serif" }}>{e.cat} · {e.date}</div>
              </div>
              <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 500, flexShrink: 0 }}>{fmt(e.amount)}</div>
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
function Expenses({ expenses, onDelete, onAddExpense, fmt = peso }) {
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-.3px' }}>Expenses</div>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink3)', marginTop: 2 }}>{expenses.length} total transactions</div>
        </div>
        <button className="btn btn-accent" onClick={onAddExpense}>
          <PlusIcon /> Add Expense
        </button>
      </div>
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
        {['All', ...new Set(expenses.map(e => e.cat))].map(c => (
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
                <td className="hide-sm" style={{ fontSize: 12, color: 'var(--ink3)', fontFamily: "'Inter', sans-serif" }}>{e.date}</td>
                <td style={{ textAlign: 'right', fontFamily: "'Inter', sans-serif", fontWeight: 500 }}>{fmt(e.amount)}</td>
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
          <span style={{ fontSize: 11, color: 'var(--ink3)', fontFamily: "'Inter', sans-serif" }}>{sorted.length} records</span>
          <span style={{ fontSize: 14, fontWeight: 600, fontFamily: "'Inter', sans-serif", letterSpacing: '-.3px' }}>{fmt(total)}</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  PAGE: BUDGETS
// ─────────────────────────────────────────────────────────────
function Budgets({ expenses, budgets, customCats, onEditBudgets, fmt = peso }) {
  const cats = catTotals(expenses);
  // Only show categories the user explicitly created, or that have a non-zero budget or spending
  const userCats = new Set(customCats || []);
  const allCats = [...new Set([...Object.keys(budgets), ...Object.keys(cats)])].filter(cat =>
    userCats.has(cat) || (budgets[cat] || 0) > 0 || (cats[cat] || 0) > 0
  );
  const tb = Object.values(budgets).reduce((s, v) => s + v, 0);
  let uA = 0, uN = 0, oA = 0, oN = 0;
  allCats.forEach(cat => {
    const spent = cats[cat] || 0, lim = budgets[cat] || 0;
    if (lim > 0 || spent > 0) {
      if (spent > lim) { oA += spent - lim; oN++; } else { uA += lim - spent; uN++; }
    }
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

      {allCats.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--ink3)', fontSize: 13 }}>
            No categories yet. Go to <b>Settings</b> to create your first category.
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-hd">
            <span className="card-title">Category Limits</span>
            <button className="btn btn-sm" onClick={onEditBudgets}>
              <EditIcon /> Edit Limits
            </button>
          </div>
          <div className="card-body">
            {allCats.map((cat, idx) => {
              const spent = cats[cat] || 0, lim = budgets[cat] || 0;
              const noLimit = lim === 0;
              const pct = noLimit ? 0 : Math.min(100, Math.round((spent / lim) * 100));
              const over = !noLimit && spent > lim, warn = !noLimit && pct > 75 && !over;
              const isEmpty = spent === 0 && noLimit;
              const isLast = idx === allCats.length - 1;
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
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  MODAL: RECURRING BILL DETAIL (edit / pause / delete / pay)
// ─────────────────────────────────────────────────────────────
function RecurringDetailModal({ bill, isPaid, onClose, onMarkPaid, onMarkUnpaid, onMarkFullyPaid, onToggle, onDelete, onEdit, fmt, payoutSchedule }) {
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState({ name: bill.name, amount: String(bill.amount), day: String(bill.day), cat: bill.cat, due: bill.due || '' });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim() || !form.amount) return;
    setBusy(true);
    try {
      const derivedDay = form.due ? new Date(form.due).getDate() : (bill.day || 1);
      await onEdit({ id: bill.id, name: form.name.trim(), amount: parseFloat(form.amount), day: derivedDay, cat: form.cat, due: form.due });
    } finally { setBusy(false); }
  };

  return (
    <Modal open={true} title={editMode ? 'Edit Bill' : bill.name} onClose={onClose}>
      {!editMode ? (
        <>
          {/* Info block */}
          <div style={{ background: 'var(--surface2)', border: '2px solid var(--border)', borderRadius: 'var(--r2)', padding: '16px 18px', marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.6px' }}>Amount</span>
              <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>{fmt(bill.amount)}<span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink3)' }}>/mo</span></span>
            </div>
            <div style={{ height: 1, background: 'var(--border)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)' }}>Category</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink)' }}>{bill.cat}</span>
            </div>
            {bill.due && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)' }}>Due Date</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink)' }}>
                  {new Date(bill.due + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' })}
                </span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)' }}>Status</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: bill.fullyPaid ? 'var(--accent2)' : bill.active ? 'var(--green-dk)' : 'var(--ink3)' }}>
                {bill.fullyPaid ? 'Fully Paid' : bill.active ? 'Active' : 'Paused'}
              </span>
            </div>
            {payoutSchedule?.cycle && (() => {
              const pa = getPayoutAssignment(bill.day, payoutSchedule, bill.due);
              if (!pa) return null;
              return (
                <>
                  <div style={{ height: 1, background: 'var(--border)' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)' }}>Assigned Payout</span>
                    <span style={{
                      fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 999,
                      background: pa.color + '18', color: pa.color, border: `1.5px solid ${pa.color}44`,
                    }}>{pa.label}</span>
                  </div>
                  {pa.note && (
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink3)', fontStyle: 'italic', textAlign: 'right' }}>
                      {pa.note}
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {bill.active && !isPaid && (
              <button className="btn rec-paid-btn" style={{ justifyContent: 'center', width: '100%', padding: '10px', fontSize: 13 }} onClick={() => onMarkPaid(bill.id)}>
                ✓ Mark as Paid This Month
              </button>
            )}
            {isPaid && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px', background: 'var(--green-bg)', border: '2px solid var(--green)', borderRadius: 'var(--r2)', fontSize: 13, fontWeight: 700, color: 'var(--green-dk)' }}>
                  ✓ Paid this month
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {onMarkFullyPaid && !bill.fullyPaid && (
                    <button
                      type="button"
                      className="btn rec-fully-paid-btn"
                      style={{ flex: 1, justifyContent: 'center', padding: '10px', fontSize: 13 }}
                      onClick={() => onMarkFullyPaid(bill.id)}
                    >
                      Mark as Fully Paid
                    </button>
                  )}
                  {onMarkUnpaid && (
                    <button
                      type="button"
                      className="btn rec-unpaid-btn"
                      style={{ flex: 1, justifyContent: 'center', padding: '10px', fontSize: 13 }}
                      onClick={() => onMarkUnpaid(bill.id)}
                    >
                      Mark as Unpaid
                    </button>
                  )}
                </div>
              </>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-sm" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setEditMode(true)}>
                <EditIcon /> Edit
              </button>
              <button className="btn btn-sm" style={{ flex: 1, justifyContent: 'center' }} onClick={() => onToggle(bill.id)}>
                {bill.active ? 'Pause' : 'Resume'}
              </button>
              <button className="btn btn-sm btn-delete" style={{ flex: 1, justifyContent: 'center' }} onClick={() => onDelete(bill.id)}>
                <TrashIcon size={13} /> Delete
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <Field label="Name">
            <input className="finput" value={form.name} onChange={e => set('name', e.target.value)} disabled={busy} />
          </Field>
          <Field label="Amount">
            <input className="finput" type="number" min="0" value={form.amount} onChange={e => set('amount', e.target.value)} disabled={busy} />
          </Field>
          <div className="g2">
            <Field label="Category">
              <input className="finput" value={form.cat} onChange={e => set('cat', e.target.value)} disabled={busy} />
            </Field>
            <Field label="Due Date">
              <input className="finput" type="date" value={form.due} onChange={e => set('due', e.target.value)} disabled={busy} />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setEditMode(false)} disabled={busy}>Cancel</button>
            <button className="btn btn-accent" style={{ flex: 1, justifyContent: 'center', opacity: busy ? 0.75 : 1 }} onClick={handleSave} disabled={busy}>
              {busy ? <><Spinner size={13} /> Saving…</> : 'Save Changes'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
//  PAGE: RECURRING
// ─────────────────────────────────────────────────────────────
function Recurring({ recurring, onToggle, onDelete, onAdd, onMarkPaid, onMarkUnpaid, onMarkFullyPaid, onEdit, fmt = peso, payoutSchedule, onNav }) {
  const [selectedBill, setSelectedBill] = useState(null);
  const active = recurring.filter(r => r.active);
  const total = active.reduce((s, r) => s + r.amount, 0);
  const today = new Date();
  const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const isPaid = (r) => !!(r.paidMonths?.includes(currentMonthKey));

  const getDiff = (r) => {
    const d = new Date(r.due || '');
    return isNaN(d) ? null : Math.round((d - today) / 864e5);
  };

  const soon = active.filter(r => {
    if (isPaid(r)) return false;
    const diff = getDiff(r);
    return diff !== null && diff >= 0 && diff <= 7;
  });
  const unpaidActive = active.filter(r => !isPaid(r));
  const paidCount = active.filter(r => isPaid(r)).length;

  // Overdue: unpaid bills whose due date has already passed
  const overdue = unpaidActive.filter(r => {
    const d = new Date((r.due || '') + 'T00:00:00');
    return !isNaN(d) && d < today;
  });
  const overdueTotal = overdue.reduce((s, r) => s + r.amount, 0);

  // Compute next two payout cycles
  const cycles = computeNextTwoCycles(payoutSchedule, today, active);

  // Sort: earliest due first, then bills with no due date at the end
  const sortedRecurring = [...recurring].sort((a, b) => {
    const da = new Date(a.due || '');
    const db_ = new Date(b.due || '');
    const aValid = !isNaN(da);
    const bValid = !isNaN(db_);
    if (aValid && bValid) return da - db_;
    if (aValid) return -1;
    if (bValid) return 1;
    return 0;
  });



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
          <div className="hsub" style={{ color: 'rgba(255,255,255,.7)' }}>{soon.length ? 'See below list' : 'No upcoming bills'}</div>
        </div>
        <div className="hero-card" style={{ background: PAYOUT_RED, borderColor: '#c0392b', transition: 'background .3s' }}>
          <div className="hlabel" style={{ color: 'rgba(255,255,255,.65)' }}>Unpaid at Cut-off</div>
          <div className="hval" style={{ color: '#fff' }}>{overdueTotal > 0 ? fmt(overdueTotal) : '—'}</div>
          <div className="hsub" style={{ color: 'rgba(255,255,255,.7)' }}>
            {overdueTotal > 0
              ? `${overdue.length} bill${overdue.length !== 1 ? 's' : ''} past due date`
              : paidCount > 0 ? `${paidCount} bill${paidCount !== 1 ? 's' : ''} paid this month` : 'All bills on track'}
          </div>
        </div>
      </div>

      {/* ── Payout Cycle Projections ───────────────────────────── */}
      {!payoutSchedule?.cycle ? (
        <div className="card gap" style={{ padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--accent-bg)', border: '1.5px solid rgba(77,105,68,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--accent)' }}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><rect x="2" y="3" width="16" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.7" /><path d="M2 8h16M7 2v2M13 2v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><path d="M6 12h3M11 12h3M6 15h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)', marginBottom: 3 }}>Payout Cycle Not Configured</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink3)' }}>Set up your payout schedule to see which bills fall under each upcoming cycle.</div>
          </div>
          {onNav && <button className="btn btn-sm btn-accent" onClick={() => onNav('settings')}>Set Up</button>}
        </div>
      ) : cycles.length > 0 ? (
        <div className="cycle-proj-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
          {cycles.map((cycle, ci) => {
            const accent = cycle.cycleType === 'first' ? PAYOUT_BLUE
              : cycle.cycleType === 'second' ? PAYOUT_VIOLET
              : '#16A085'; // monthly
            const pct = cycle.totalAll > 0 ? Math.round((cycle.paidTotal / cycle.totalAll) * 100) : 0;
            const allPaid = cycle.bills.length > 0 && cycle.unpaid.length === 0;

            return (
              <div key={ci} style={{
                background: 'var(--surface)',
                border: `1.5px solid ${accent}44`,
                borderRadius: 'var(--r)',
                overflow: 'hidden',
                boxShadow: `0 2px 12px ${accent}18`,
              }}>
                {/* Card header */}
                <div style={{
                  background: allPaid ? 'var(--green-bg)' : `${accent}12`,
                  borderBottom: `1.5px solid ${accent}30`,
                  padding: '12px 16px 10px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.9px', textTransform: 'uppercase', color: accent, marginBottom: 3 }}>
                        {cycle.label}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-.2px' }}>
                        {cycle.dateLabel}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 999,
                      background: cycle.daysUntil <= 3 ? '#E74C3C22' : `${accent}18`,
                      color: cycle.daysUntil <= 3 ? '#E74C3C' : accent,
                      border: `1.5px solid ${cycle.daysUntil <= 3 ? '#E74C3C' : accent}44`,
                      whiteSpace: 'nowrap',
                    }}>
                      {cycle.daysUntil === 1 ? 'Tomorrow' : cycle.daysUntil === 0 ? 'Today' : `in ${cycle.daysUntil}d`}
                    </span>
                  </div>
                  {/* Amount + progress */}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
                    <span style={{ fontSize: 22, fontWeight: 700, color: allPaid ? 'var(--green-dk)' : 'var(--ink)', letterSpacing: '-.5px', lineHeight: 1 }}>
                      {allPaid ? fmt(cycle.totalAll) : fmt(cycle.total)}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink3)' }}>
                      {allPaid ? '✓ all paid' : `of ${fmt(cycle.totalAll)}`}
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div style={{ marginTop: 8, height: 5, background: 'var(--border)', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: allPaid ? 'var(--green)' : accent, borderRadius: 999, transition: 'width .5s cubic-bezier(.25,1,.5,1)' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink3)' }}>{cycle.paid.length} of {cycle.bills.length} paid</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: allPaid ? 'var(--green-dk)' : accent }}>{pct}%</span>
                  </div>
                </div>

                {/* Bill list */}
                <div style={{ padding: cycle.bills.length === 0 ? '16px' : '6px 0 4px' }}>
                  {cycle.bills.length === 0 ? (
                    <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 600, color: 'var(--ink3)' }}>No bills in this cycle</div>
                  ) : (
                    <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                      {/* Unpaid first, then paid */}
                      {[...cycle.unpaid, ...cycle.paid].map((r, bi) => {
                        const isLastBill = bi === cycle.bills.length - 1;
                        const billPaid = cycle.paid.includes(r);
                        return (
                          <div key={r.id} style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '8px 16px',
                            borderBottom: isLastBill ? 'none' : '1px solid var(--border)',
                            opacity: billPaid ? 0.55 : 1,
                            transition: 'opacity .2s',
                          }}>
                            {/* Status dot */}
                            <div style={{
                              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                              background: billPaid ? 'var(--green)' : accent,
                              border: `1.5px solid ${billPaid ? 'var(--green-dk)' : accent}`,
                            }} />
                            {/* Name */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: billPaid ? 'line-through' : 'none' }}>
                                {r.name}
                              </div>
                              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink3)' }}>Day {r.day}</div>
                            </div>
                            {/* Amount */}
                            <span style={{ fontSize: 12, fontWeight: 600, color: billPaid ? 'var(--ink3)' : 'var(--ink)', whiteSpace: 'nowrap', textDecoration: billPaid ? 'line-through' : 'none' }}>
                              {fmt(r.amount)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-accent btn-sm" onClick={onAdd}><PlusIcon /> Add Recurring</button>
      </div>

      {/* Merged bill card grid — sorted earliest due first */}
      <div className="card">
        <div className="card-hd">
          <span className="card-title">All Subscriptions &amp; Bills</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)' }}>{recurring.length} TOTAL BILLS</span>
        </div>
        <div style={{ padding: '0 0 4px' }}>
          {sortedRecurring.map((r, idx) => {
            const paid = isPaid(r);
            const diff = getDiff(r);
            const isOverdue = !paid && diff !== null && diff < 0;
            const isSoon = !paid && diff !== null && diff >= 0 && diff <= 7;
            const isGreen = !paid && diff !== null && diff > 7;
            const isToday = diff === 0;
            const isTomorrow = diff === 1;
            const urgencyLabel = paid ? '✓ Paid'
              : isOverdue ? `Overdue ${Math.abs(diff)}d`
                : isToday ? 'Due Today'
                  : isTomorrow ? 'Due Tomorrow'
                    : isSoon ? `Due in ${diff}d`
                      : isGreen ? `In ${diff}d`
                        : null;
            const accentColor = isOverdue ? '#E74C3C' : isSoon ? '#F5A623' : (paid || isGreen) ? '#27AE60' : 'var(--border)';
            const accentDark = isOverdue ? '#c0392b' : isSoon ? '#d4880e' : (paid || isGreen) ? '#1e8449' : 'var(--ink3)';
            const isLast = idx === sortedRecurring.length - 1;

            return (
              <div
                key={r.id}
                onClick={() => setSelectedBill(r)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '13px 20px',
                  borderBottom: isLast ? 'none' : '1px solid var(--border)',
                  opacity: r.active ? 1 : 0.45,
                  cursor: 'pointer',
                  transition: 'background .1s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface2)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = ''; }}
              >
                {/* Colored left dot */}
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: accentColor, border: `2px solid ${accentDark}`, flexShrink: 0 }} />

                {/* Bill icon */}
                <div className="cat-ico sm" style={{ background: 'rgba(192,57,43,.1)', color: '#C0392B', borderColor: '#C0392B55', flexShrink: 0 }}>
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                    <path d="M5 2h7l4 4v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
                    <path d="M12 2v4h4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                    <path d="M7 9h6M7 12h6M7 15h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </div>

                {/* Name + subtitle */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink3)', marginTop: 2 }}>Day {r.day} · {r.cat}</div>
                  {payoutSchedule?.cycle && (() => {
                    const pa = getPayoutAssignment(r.day, payoutSchedule, r.due);
                    if (!pa) return null;
                    return (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4, fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 999, background: pa.color + '18', color: pa.color, border: `1px solid ${pa.color}44`, whiteSpace: 'nowrap', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <svg width="8" height="8" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}><circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2.5" /><path d="M10 6v4l2.5 2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                        {pa.label}
                      </div>
                    );
                  })()}
                </div>

                {/* Urgency badge */}
                {urgencyLabel && (
                  <span style={{
                    fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap', flexShrink: 0,
                    color: accentDark,
                    background: accentColor + '22',
                    border: `1.5px solid ${accentColor}`,
                    borderRadius: 999, padding: '3px 9px',
                  }}>
                    {urgencyLabel}
                  </span>
                )}
                {r.fullyPaid && <span className="badge" style={{ fontSize: 9, flexShrink: 0, background: 'var(--accent-bg)', color: 'var(--accent2)', border: '1px solid rgba(45,181,163,.35)' }}>Fully Paid</span>}
                {!r.active && !r.fullyPaid && <span className="badge bl" style={{ fontSize: 9, flexShrink: 0 }}>Paused</span>}

                {/* Amount */}
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', flexShrink: 0, minWidth: 64, textAlign: 'right' }}>{fmt(r.amount)}</span>

                {/* Arrow */}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, color: 'var(--ink3)' }}>
                  <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            );
          })}
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--ink3)', fontFamily: "'Inter', sans-serif" }}>
          Bill Shield — MoneyLens tracks your billing cycles and flags upcoming charges so you&apos;re never caught off guard.
        </div>
      </div>

      {/* Bill detail modal — portaled to document.body to escape .shell overflow:hidden */}
      {selectedBill && createPortal(
        <RecurringDetailModal
          bill={selectedBill}
          isPaid={isPaid(selectedBill)}
          onClose={() => setSelectedBill(null)}
          onMarkPaid={(id) => { onMarkPaid(id); setSelectedBill(null); }}
          onMarkUnpaid={(id) => { onMarkUnpaid(id); setSelectedBill(null); }}
          onMarkFullyPaid={(id) => { onMarkFullyPaid(id); setSelectedBill(null); }}
          onToggle={(id) => { onToggle(id); setSelectedBill(null); }}
          onDelete={(id) => { setSelectedBill(null); onDelete(id); }}
          onEdit={(bill) => { setSelectedBill(null); onEdit(bill); }}
          fmt={fmt}
          payoutSchedule={payoutSchedule}
        />,
        document.body
      )}
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
                <div style={{ fontSize: 11, color: 'var(--ink3)', fontFamily: "'Inter', sans-serif", letterSpacing: '.1px', marginBottom: 22 }}>
                  Deadline: {g.deadline.replace('-', '/')}
                </div>
                <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 30, letterSpacing: '-.5px', lineHeight: 1 }}>{fmt(g.saved)}</div>
                <div style={{ fontSize: 11, color: 'var(--ink3)', fontFamily: "'Inter', sans-serif", margin: '6px 0 14px' }}>of {fmt(g.target)} target</div>
                <div className="pbar"><div className="pbar-fill" style={{ width: `${pct}%` }} /></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--ink3)', fontFamily: "'Inter', sans-serif", marginTop: 6, marginBottom: 20 }}>
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
//  PAGE: REPORTS
// ─────────────────────────────────────────────────────────────
function Reports({ expenses, budgets, recurring, fmt = peso }) {
  const now = new Date();
  const [selYear, setSelYear] = useState(now.getFullYear());
  const [selMonth, setSelMonth] = useState(now.getMonth()); // 0-indexed
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // helpers
  const pad = (n) => String(n).padStart(2, '0');
  const monthKey = (y, m) => `${y}-${pad(m + 1)}`;
  const prevMonth = () => { if (selMonth === 0) { setSelMonth(11); setSelYear(y => y - 1); } else setSelMonth(m => m - 1); };
  const nextMonth = () => { if (selMonth === 11) { setSelMonth(0); setSelYear(y => y + 1); } else setSelMonth(m => m + 1); };
  const isCurrentMonth = selYear === now.getFullYear() && selMonth === now.getMonth();

  // Filter expenses for selected month and previous month
  const mk = monthKey(selYear, selMonth);
  const monthExp = expenses.filter(e => e.date && e.date.startsWith(mk));
  const prevMk = selMonth === 0 ? monthKey(selYear - 1, 11) : monthKey(selYear, selMonth - 1);
  const prevExp = expenses.filter(e => e.date && e.date.startsWith(prevMk));

  // Stats
  const total = monthExp.reduce((s, e) => s + (e.amount || 0), 0);
  const prevTotal = prevExp.reduce((s, e) => s + (e.amount || 0), 0);
  const txCount = monthExp.length;
  const avgPerTx = txCount > 0 ? Math.round(total / txCount) : 0;
  const daysInMonth = new Date(selYear, selMonth + 1, 0).getDate();
  const uniqueDays = new Set(monthExp.map(e => e.date)).size;
  const dailyAvg = uniqueDays > 0 ? Math.round(total / uniqueDays) : 0;

  // Change vs previous month
  const change = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : (total > 0 ? 100 : 0);
  const changeUp = change > 0;

  // Daily spending data (for bar chart)
  const dailyTotals = {};
  monthExp.forEach(e => {
    const day = parseInt(e.date.split('-')[2]);
    dailyTotals[day] = (dailyTotals[day] || 0) + (e.amount || 0);
  });
  const maxDaily = Math.max(...Object.values(dailyTotals), 1);

  // Category breakdown for this month
  const catMap = {};
  monthExp.forEach(e => { catMap[e.cat] = (catMap[e.cat] || 0) + (e.amount || 0); });
  const catEntries = Object.entries(catMap).sort((a, b) => b[1] - a[1]);

  // Top 5 biggest expenses
  const topExp = [...monthExp].sort((a, b) => b.amount - a.amount).slice(0, 5);

  // Recurring costs for context
  const activeBills = recurring.filter(r => r.active);
  const fixedCosts = activeBills.reduce((s, r) => s + r.amount, 0);

  // Budget usage for this month
  const budgetCats = Object.keys(budgets).filter(c => budgets[c] > 0);

  return (
    <div className="page-enter">
      {/* Month Navigator */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px' }}>
          <button className="btn btn-sm" onClick={prevMonth} style={{ minWidth: 36, justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)', fontFamily: "'Inter', sans-serif" }}>{MONTHS[selMonth]} {selYear}</div>
            {isCurrentMonth && <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', letterSpacing: '.5px', textTransform: 'uppercase', marginTop: 2 }}>Current Month</div>}
          </div>
          <button className="btn btn-sm" onClick={nextMonth} style={{ minWidth: 36, justifyContent: 'center' }} disabled={isCurrentMonth}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="hero-grid gap">
        <div className="hero-card">
          <div className="hlabel">Total Spent</div>
          <div className="hval">{fmt(total)}</div>
          <div className="hsub">{txCount} transaction{txCount !== 1 ? 's' : ''}</div>
        </div>
        <div className="hero-card" style={{ background: 'var(--ink)' }}>
          <div className="hlabel">Avg / Transaction</div>
          <div className="hval">{fmt(avgPerTx)}</div>
          <div className="hsub">{fmt(dailyAvg)}/day</div>
        </div>
        <div className="hero-card" style={{ background: prevTotal > 0 && changeUp ? '#C0392B' : prevTotal > 0 ? '#27ae60' : 'var(--ink)', borderColor: prevTotal > 0 && changeUp ? '#a93226' : prevTotal > 0 ? '#1e8449' : 'var(--ink)', transition: 'background .3s' }}>
          <div className="hlabel">vs {MONTHS[selMonth === 0 ? 11 : selMonth - 1].slice(0, 3)}</div>
          <div className="hval">{prevTotal > 0 ? `${changeUp ? '+' : ''}${change}%` : '\u2014'}</div>
          <div className="hsub">{prevTotal > 0 ? (changeUp ? `${fmt(total - prevTotal)} more` : `${fmt(prevTotal - total)} less`) : 'no prior data'}</div>
        </div>
      </div>

      {/* Daily spending chart */}
      {txCount > 0 && (
        <div className="card gap">
          <div className="card-hd">
            <span className="card-title">Daily Spending</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)' }}>{uniqueDays} active day{uniqueDays !== 1 ? 's' : ''}</span>
          </div>
          <div className="card-body" style={{ padding: '16px 20px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 120 }}>
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                const val = dailyTotals[day] || 0;
                const h = val > 0 ? Math.max(4, Math.round((val / maxDaily) * 100)) : 0;
                const isToday = isCurrentMonth && day === now.getDate();
                return (
                  <div key={day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }} title={`Day ${day}: ${fmt(val)}`}>
                    <div style={{
                      width: '100%', minWidth: 4, maxWidth: 18, height: h, borderRadius: 2,
                      background: isToday ? 'var(--accent)' : val > 0 ? 'var(--ink)' : 'var(--border)',
                      opacity: val > 0 ? 1 : 0.25,
                      transition: 'height .3s'
                    }} />
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink3)' }}>1</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink3)' }}>{Math.ceil(daysInMonth / 2)}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink3)' }}>{daysInMonth}</span>
            </div>
          </div>
        </div>
      )}

      {/* Category breakdown */}
      {catEntries.length > 0 && (
        <div className="card gap">
          <div className="card-hd">
            <span className="card-title">By Category</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)' }}>{catEntries.length} CATEGORIES</span>
          </div>
          <div className="card-body">
            {catEntries.map(([cat, v], i) => {
              const pct = Math.round((v / (total || 1)) * 100);
              const lim = budgets[cat] || 0;
              const overBudget = lim > 0 && v > lim;
              const isLast = i === catEntries.length - 1;
              return (
                <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: isLast ? 'none' : '1px solid var(--border)' }}>
                  <div className="cat-ico sm" style={{ background: getCatBg(cat), color: getCatFg(cat), borderColor: getCatFg(cat) }}><CatIcon name={cat} size={20} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{cat}</span>
                      {overBudget && <span className="badge br" style={{ fontSize: 9 }}>Over</span>}
                    </div>
                    <div className="pbar" style={{ height: 3, marginTop: 4 }}>
                      <div className={`pbar-fill${overBudget ? ' over' : ''}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, fontFamily: "'Inter', sans-serif", color: 'var(--ink)' }}>{fmt(v)}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink3)' }}>{pct}%{lim > 0 ? ` of ${fmt(lim)}` : ''}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top expenses */}
      {topExp.length > 0 && (
        <div className="card gap">
          <div className="card-hd">
            <span className="card-title">Top Expenses</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)' }}>BIGGEST THIS MONTH</span>
          </div>
          <div className="card-body">
            {topExp.map((exp, i) => (
              <div key={exp.id || i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: i < topExp.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent-bg)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, fontFamily: "'Inter', sans-serif", flexShrink: 0 }}>{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{exp.name || 'Untitled'}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{exp.cat} &middot; {exp.date}</div>
                </div>
                <span style={{ fontSize: 14, fontWeight: 800, fontFamily: "'Inter', sans-serif", color: 'var(--ink)', flexShrink: 0 }}>{fmt(exp.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fixed costs card */}
      {activeBills.length > 0 && (
        <div className="card gap">
          <div className="card-hd">
            <span className="card-title">Fixed Monthly Costs</span>
            <span style={{ fontSize: 13, fontWeight: 800, fontFamily: "'Inter', sans-serif", color: 'var(--ink)' }}>{fmt(fixedCosts)}</span>
          </div>
          <div className="card-body">
            {activeBills.map((b, i) => (
              <div key={b.id || i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < activeBills.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="cat-ico sm" style={{ background: getCatBg(b.cat), color: getCatFg(b.cat), borderColor: getCatFg(b.cat) }}><CatIcon name={b.cat} size={18} /></div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{b.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--ink3)' }}>Due day {b.day}</div>
                  </div>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "'Inter', sans-serif" }}>{fmt(b.amount)}</span>
              </div>
            ))}
            {total > 0 && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: 'var(--ink3)' }}>
                <span>Fixed costs = {Math.round((fixedCosts / (total + fixedCosts)) * 100)}% of total outflow</span>
                <span>Variable = {fmt(total)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Budget overview for this month */}
      {budgetCats.length > 0 && catEntries.length > 0 && (
        <div className="card">
          <div className="card-hd">
            <span className="card-title">Budget Usage</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)' }}>{MONTHS[selMonth].slice(0, 3)} {selYear}</span>
          </div>
          <div className="card-body">
            {budgetCats.map((cat, i) => {
              const spent = catMap[cat] || 0;
              const lim = budgets[cat];
              const pct = Math.min(100, Math.round((spent / lim) * 100));
              const over = spent > lim;
              const isLast = i === budgetCats.length - 1;
              return (
                <div key={cat} style={{ padding: '10px 0', borderBottom: isLast ? 'none' : '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{cat}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: over ? 'var(--red)' : 'var(--ink3)', fontFamily: "'Inter', sans-serif" }}>{fmt(spent)} / {fmt(lim)}</span>
                  </div>
                  <div className="pbar" style={{ height: 4 }}>
                    <div className={`pbar-fill${over ? ' over' : ''}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {txCount === 0 && (
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--ink3)', fontSize: 13 }}>
            No expenses recorded for {MONTHS[selMonth]} {selYear}.<br />
            <span style={{ fontSize: 12, color: 'var(--ink3)' }}>Navigate to a different month or add expenses.</span>
          </div>
        </div>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
//  PAGE: SETTINGS
// ─────────────────────────────────────────────────────────────
function Settings({ budgets, onSaveBudgets, customCats, onAddCustomCat, currency, onCurrencyChange, fmt = peso, payoutSchedule, onSavePayoutSchedule }) {
  const [form, setForm] = useState({ ...budgets });
  const [saved, setSaved] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [newLim, setNewLim] = useState('');

  // Payout schedule form state
  const [payForm, setPayForm] = useState({
    cycle: payoutSchedule?.cycle || 'monthly',
    weekDay: payoutSchedule?.weekDay || 'Friday',
    dates: payoutSchedule?.dates || [15, 30],
    date: payoutSchedule?.date || 30,
  });
  const [paySaved, setPaySaved] = useState(false);
  const [paySaveError, setPaySaveError] = useState('');

  useEffect(() => {
    if (payoutSchedule) {
      setPayForm({
        cycle: payoutSchedule.cycle || 'monthly',
        weekDay: payoutSchedule.weekDay || 'Friday',
        dates: payoutSchedule.dates || [15, 30],
        date: payoutSchedule.date || 30,
      });
    }
  }, [payoutSchedule]);

  // ── FIX: only update state after confirmed Firestore write ──
  const handlePaySave = async () => {
    setPaySaveError('');
    try {
      await onSavePayoutSchedule(payForm);
      setPaySaved(true);
      setTimeout(() => setPaySaved(false), 2000);
    } catch (err) {
      console.error('Payout schedule save error:', err);
      setPaySaveError('Failed to save. Check your connection or Firestore rules.');
    }
  };

  const CYCLE_OPTIONS = [
    { value: 'bi-weekly', label: 'Bi-Weekly (Semi-Monthly)' },
    { value: 'monthly', label: 'Monthly' },
  ];
  const DATE_OPTIONS = Array.from({ length: 31 }, (_, i) => i + 1);

  const SelectArrow = () => (
    <div style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--accent)' }}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </div>
  );

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

  const allCats = [...(customCats || [])];
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
              const isCustom = true;
              const isLast = idx === allCats.length - 1;
              const dot = CAT_DOT[cat] || 'var(--ink3)';
              return (
                <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: isLast ? 'none' : '1.5px solid var(--border)' }}>
                  {/* Dot */}
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                  {/* Name — no wrap, takes remaining space */}
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {cat}

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

        {/* Payout Schedule */}
        <div className="card">
          <div className="card-hd">
            <span className="card-title">Payout Schedule</span>
            {payoutSchedule?.cycle && (
              <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.6px', background: 'var(--accent-bg)', padding: '3px 10px', borderRadius: 999, border: '1.5px solid rgba(77,105,68,.2)' }}>
                {CYCLE_OPTIONS.find(o => o.value === payoutSchedule.cycle)?.label || payoutSchedule.cycle}
              </span>
            )}
          </div>
          <div className="card-body" style={{ padding: '12px 20px 18px' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink3)', marginBottom: 16, lineHeight: 1.7, padding: '10px 12px', background: 'var(--surface2)', borderRadius: 'var(--r2)', border: '1.5px solid var(--border)' }}>
              Set your payout cycle so MoneyLens can automatically assign each recurring bill to the correct payout period, helping you avoid missed or delayed payments.
            </div>

            {/* Cycle selector */}
            <Field label="Payout Cycle">
              <div style={{ position: 'relative' }}>
                <select className="finput" value={payForm.cycle}
                  style={{ paddingRight: 36, appearance: 'none', WebkitAppearance: 'none' }}
                  onChange={e => setPayForm(p => ({ ...p, cycle: e.target.value }))}>
                  {CYCLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <SelectArrow />
              </div>
            </Field>

            {/* Bi-Weekly → two dates */}
            {payForm.cycle === 'bi-weekly' && (
              <>
                <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 10, padding: '8px 10px', background: 'var(--amber-bg)', borderRadius: 10, border: '1.5px solid rgba(192,139,58,.2)', color: 'var(--amber-dk)' }}>
                  Choose the two dates each month you receive your payout (e.g. 15th and 30th).
                </div>
                <div className="g2">
                  <Field label="1st Payout Date">
                    <div style={{ position: 'relative' }}>
                      <select className="finput" value={payForm.dates?.[0] ?? 15}
                        style={{ paddingRight: 36, appearance: 'none', WebkitAppearance: 'none' }}
                        onChange={e => setPayForm(p => ({ ...p, dates: [parseInt(e.target.value), p.dates?.[1] ?? 30] }))}>
                        {DATE_OPTIONS.map(d => <option key={d} value={d}>{ordinal(d)}</option>)}
                      </select>
                      <SelectArrow />
                    </div>
                  </Field>
                  <Field label="2nd Payout Date">
                    <div style={{ position: 'relative' }}>
                      <select className="finput" value={payForm.dates?.[1] ?? 30}
                        style={{ paddingRight: 36, appearance: 'none', WebkitAppearance: 'none' }}
                        onChange={e => setPayForm(p => ({ ...p, dates: [p.dates?.[0] ?? 15, parseInt(e.target.value)] }))}>
                        {DATE_OPTIONS.map(d => <option key={d} value={d}>{ordinal(d)}</option>)}
                      </select>
                      <SelectArrow />
                    </div>
                  </Field>
                </div>
              </>
            )}

            {/* Monthly → single date */}
            {payForm.cycle === 'monthly' && (
              <Field label="Payout Date (Day of Month)">
                <div style={{ position: 'relative' }}>
                  <select className="finput" value={payForm.date ?? 30}
                    style={{ paddingRight: 36, appearance: 'none', WebkitAppearance: 'none' }}
                    onChange={e => setPayForm(p => ({ ...p, date: parseInt(e.target.value) }))}>
                    {DATE_OPTIONS.map(d => <option key={d} value={d}>{ordinal(d)}</option>)}
                  </select>
                  <SelectArrow />
                </div>
              </Field>
            )}

            {/* Preview */}
            {payForm.cycle && (
              <div style={{ marginBottom: 16, padding: '12px 14px', background: 'var(--surface2)', borderRadius: 'var(--r2)', border: '1.5px solid var(--border)' }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.7px', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Assignment Preview</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {[5, 12, 17, 22, 28].map(day => {
                    const pa = getPayoutAssignment(day, payForm);
                    if (!pa) return null;
                    return (
                      <div key={day} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink2)', fontFamily: "'Inter', sans-serif", minWidth: 80 }}>Bill on {ordinal(day)}</span>
                        <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 10px', borderRadius: 999, background: pa.color + '18', color: pa.color, border: `1.5px solid ${pa.color}44`, whiteSpace: 'nowrap' }}>{pa.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Error message */}
            {paySaveError && (
              <div style={{ marginBottom: 10, padding: '8px 12px', background: 'var(--red-bg)', border: '1.5px solid var(--red)', borderRadius: 'var(--r2)', fontSize: 12, fontWeight: 600, color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertIcon size={12} /> {paySaveError}
              </div>
            )}

            <button className="btn btn-accent btn-sm" onClick={handlePaySave}>
              {paySaved ? '✓ Saved!' : 'Save Schedule'}
            </button>
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
    id: 'insights', label: 'Reports', group: 'Planning',
    icon: <svg width="18" height="18" viewBox="0 0 14 14" fill="none"><path d="M1.5 11l2.5-4 2.5 1.5 2-4 3.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /><path d="M1 13h12" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" /></svg>,
  },
  {
    id: 'settings', label: 'Settings', group: 'Account',
    icon: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.3" /><path d="M9 1v2M9 15v2M1 9h2M15 9h2M3.2 3.2l1.4 1.4M13.4 13.4l1.4 1.4M3.2 14.8l1.4-1.4M13.4 4.6l1.4-1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
  },
];

// ─────────────────────────────────────────────────────────────
//  CONFIRM SIGN OUT MODAL
// ─────────────────────────────────────────────────────────────
function ConfirmSignOut({ open, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) setBusy(false); }, [open]);

  const handleConfirm = async () => {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} title="Sign Out" onClose={busy ? undefined : onCancel}>
      <div style={{ textAlign: 'center', padding: '8px 0 20px' }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          background: 'var(--surface2)', border: '1.5px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 16px',
        }}>
          <svg width="24" height="24" viewBox="0 0 20 20" fill="none">
            <path d="M7 17H4a1 1 0 01-1-1V4a1 1 0 011-1h3" stroke="var(--ink2)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M14 14l4-4-4-4M8 10h10" stroke="var(--ink2)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>
          Sign out of MoneyLens?
        </div>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink3)', lineHeight: 1.6 }}>
          You'll need to sign back in to access your data.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          className="btn btn-accent"
          style={{ flex: 1, justifyContent: 'center', opacity: busy ? 0.75 : 1 }}
          onClick={handleConfirm}
          disabled={busy}
        >
          {busy ? <><Spinner size={13} /> Signing out…</> : 'Yes, Sign Out'}
        </button>
      </div>
    </Modal>
  );
}

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
  const [signOutConfirm, setSignOutConfirm] = useState(false);
  const [customCats, setCustomCats] = useState([]);
  const [addCatOpen, setAddCatOpen] = useState(false);
  const [currency, setCurrency] = useState(() => localStorage.getItem('ml_currency') || 'PHP');
  const [payoutSchedule, setPayoutSchedule] = useState(null);
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
      (snap) => {
        if (snap.exists()) {
          // Filter out stale pre-set categories with zero budget
          const raw = snap.data();
          const cleaned = {};
          for (const [k, v] of Object.entries(raw)) { if (v > 0) cleaned[k] = v; }
          setBudgets(cleaned);
        }
      },
      () => { }
    );
    const unsubPayout = onSnapshot(
      doc(db, 'users', uid, 'config', 'payoutSchedule'),
      (snap) => { if (snap.exists()) setPayoutSchedule(snap.data()); },
      (err) => { console.error('Firestore payoutSchedule read error:', err); }
    );
    return () => { unsubExpenses(); unsubRecurring(); unsubGoals(); unsubBudgets(); unsubPayout(); };
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

  // ── Payout schedule handler ────────────────────────────────
  // FIX: removed silent catch — errors now propagate so the
  // Settings component can display them to the user. Local state
  // is only updated after the Firestore write confirms success.
  const savePayoutSchedule = async (schedule) => {
    await setDoc(doc(db, 'users', uid, 'config', 'payoutSchedule'), schedule);
    setPayoutSchedule(schedule);
    toast.show('Payout schedule saved');
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
  const editRecurring = async ({ id, ...fields }) => {
    try {
      await updateDoc(userDoc('recurring', id), fields);
      toast.show('Bill updated');
    } catch {
      setRecurring(prev => prev.map(r => r.id === id ? { ...r, ...fields } : r));
      toast.show('Updated locally');
    }
  };
  const toggleRecurring = async (id) => {
    const r = recurring.find(r => r.id === id);
    if (!r) return;
    const resuming = !r.active;
    const update = resuming ? { active: true, fullyPaid: false } : { active: false };
    try {
      await updateDoc(userDoc('recurring', id), update);
    } catch {
      setRecurring(prev => prev.map(r => r.id === id ? { ...r, ...update } : r));
    }
  };
  const markPaidRecurring = async (id) => {
    const r = recurring.find(r => r.id === id);
    if (!r) return;
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const paidMonths = r.paidMonths || [];
    if (paidMonths.includes(monthKey)) return;
    const newPaid = [...paidMonths, monthKey];

    // Advance the due date by exactly one month, preserving the day-of-month.
    // e.g. 2026-03-15 -> 2026-04-15. If the bill has no due date, leave it as-is.
    let nextDue = r.due || '';
    if (nextDue) {
      const d = new Date(nextDue + 'T00:00:00');
      d.setMonth(d.getMonth() + 1);
      const pad = n => String(n).padStart(2, '0');
      nextDue = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    const update = { paidMonths: newPaid, ...(nextDue && { due: nextDue }) };
    try {
      await updateDoc(userDoc('recurring', id), update);
    } catch {
      // no-op: Firestore snapshot will sync state
    }
    // Always update local state immediately so the UI reflects the change
    // without waiting for the next Firestore snapshot.
    setRecurring(prev => prev.map(r => r.id === id ? { ...r, ...update } : r));
    toast.show(`${r.name} marked as paid`);
  };
  const markUnpaidRecurring = async (id) => {
    const r = recurring.find(r => r.id === id);
    if (!r) return;
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const paidMonths = r.paidMonths || [];
    if (!paidMonths.includes(monthKey)) return;
    const newPaid = paidMonths.filter(m => m !== monthKey);
    const update = { paidMonths: newPaid };
    try {
      await updateDoc(userDoc('recurring', id), update);
    } catch {
      // no-op: Firestore snapshot will sync state
    }
    setRecurring(prev => prev.map(r => r.id === id ? { ...r, ...update } : r));
    toast.show(`${r.name} marked as unpaid`);
  };
  const markFullyPaidRecurring = async (id) => {
    const r = recurring.find(r => r.id === id);
    if (!r) return;
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const paidMonths = r.paidMonths || [];
    const update = {
      fullyPaid: true,
      active: false,
      paidMonths: paidMonths.includes(monthKey) ? paidMonths : [...paidMonths, monthKey],
    };
    try {
      await updateDoc(userDoc('recurring', id), update);
    } catch {
      // no-op: Firestore snapshot will sync state
    }
    setRecurring(prev => prev.map(r => r.id === id ? { ...r, ...update } : r));
    toast.show(`${r.name} marked as fully paid`);
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
        fontFamily: "'Inter', sans-serif",
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
            <button className="btn btn-sm btn-ghost" onClick={() => setSignOutConfirm(true)} title="Sign Out" style={{ gap: 5 }}>
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
            <button className="btn btn-sm btn-ghost" onClick={() => setSignOutConfirm(true)} style={{ width: '100%', justifyContent: 'center', fontSize: 11, padding: '6px 10px', gap: 5 }}>
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
            <Expenses key="expenses" expenses={expenses} onDelete={confirmDeleteExpense} onAddExpense={() => openModal('add-expense')} fmt={fmt} />
          )}
          {page === 'budgets' && (
            <Budgets key="budgets" expenses={expenses} budgets={budgets} customCats={customCats} onEditBudgets={() => openModal('edit-budgets')} fmt={fmt} />
          )}
          {page === 'recurring' && (
            <Recurring
              key="recurring"
              recurring={recurring}
              onToggle={toggleRecurring}
              onDelete={confirmDeleteRecurring}
              onAdd={() => openModal('add-recurring')}
              onMarkPaid={markPaidRecurring}
              onMarkUnpaid={markUnpaidRecurring}
              onMarkFullyPaid={markFullyPaidRecurring}
              onEdit={editRecurring}
              fmt={fmt}
              payoutSchedule={payoutSchedule}
              onNav={setPage}
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
            <Reports key="reports" expenses={expenses} budgets={budgets} recurring={recurring} fmt={fmt} />
          )}
          {page === 'settings' && (
            <Settings key="settings" budgets={budgets} onSaveBudgets={saveBudgets} customCats={customCats} currency={currency} onCurrencyChange={(code) => { setCurrency(code); localStorage.setItem('ml_currency', code); }} fmt={fmt} payoutSchedule={payoutSchedule} onSavePayoutSchedule={savePayoutSchedule} onAddCustomCat={(name) => { if (name.startsWith('__delete__')) { const cat = name.replace('__delete__', ''); setCustomCats(p => p.filter(c => c !== cat)); const nb = { ...budgets }; delete nb[cat]; saveBudgets(nb); toast.show(cat + ' category removed'); } else { setCustomCats(p => [...p, name]); toast.show(name + ' category added'); } }} />
          )}
        </main>
      </div>

      {/* ── MODALS ─────────────────────────────────────────── */}
      <ConfirmSignOut
        open={signOutConfirm}
        onCancel={() => setSignOutConfirm(false)}
        onConfirm={async () => { await handleSignOut(); setSignOutConfirm(false); }}
      />
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
      <AddRecurringModal open={modal === 'add-recurring'} onClose={closeModal} onSave={addRecurring} customCats={customCats} onAddCat={() => setAddCatOpen(true)} currSymbol={currSymbol} payoutSchedule={payoutSchedule} />
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
  const allCats = [...(customCats || [])];
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
  const [form, setForm] = useState({ name: '', amount: '', date: new Date().toISOString().slice(0, 10), cat: (customCats && customCats[0]) || '', note: '' });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  useEffect(() => { if (!open) setBusy(false); }, [open]);

  const handleSave = async () => {
    if (!form.name.trim() || !form.amount || !form.date) return;
    setBusy(true);
    try {
      await onSave({ name: form.name.trim(), amount: parseFloat(form.amount), date: form.date, cat: form.cat, note: form.note.trim() });
      setForm({ name: '', amount: '', date: new Date().toISOString().slice(0, 10), cat: (customCats && customCats[0]) || '', note: '' });
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
      {Object.keys(budgets).filter(c => budgets[c] > 0).length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--ink3)', fontSize: 13 }}>No categories yet. Create categories in Settings first.</div>
      ) : Object.keys(budgets).filter(c => budgets[c] > 0).map(c => (
        <Field key={c} label={c}>
          <input className="finput" type="number" min="0" value={form[c] || ''} placeholder="0" onChange={e => setForm(p => ({ ...p, [c]: e.target.value === '' ? 0 : parseFloat(e.target.value) || 0 }))} disabled={busy} />
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

// Given a due date string (YYYY-MM-DD) and a payoutSchedule, compute which
// payout (1st or 2nd for bi-weekly, or monthly) would pre-fund this bill.
function getPrefundPreview(dueDateStr, billFreq, payoutSchedule) {
  if (!dueDateStr || !payoutSchedule?.cycle) return null;
  const dueDate = new Date(dueDateStr + 'T00:00:00');
  if (isNaN(dueDate)) return null;

  if (billFreq === 'bi-weekly' && payoutSchedule.cycle === 'bi-weekly') {
    const sorted = [...(payoutSchedule.dates || [15, 30])].sort((a, b) => a - b);
    const [d1, d2] = sorted;
    const y = dueDate.getFullYear(), m = dueDate.getMonth();
    const candidates = [
      new Date(y, m - 1, d1), new Date(y, m - 1, d2),
      new Date(y, m, d1), new Date(y, m, d2),
    ].filter(d => d < dueDate).sort((a, b) => b - a);
    const assigned = candidates[0];
    if (!assigned) return { label: 'Past Due', color: PAYOUT_RED };
    return {
      label: fmtPayDate(assigned),
      color: assigned.getDate() === d2 ? PAYOUT_VIOLET : PAYOUT_BLUE,
    };
  }

  if (billFreq === 'monthly' && payoutSchedule.cycle === 'bi-weekly') {
    const sorted = [...(payoutSchedule.dates || [15, 30])].sort((a, b) => a - b);
    const [d1, d2] = sorted;
    const y = dueDate.getFullYear(), m = dueDate.getMonth();
    const candidates = [
      new Date(y, m - 1, d1), new Date(y, m - 1, d2),
      new Date(y, m, d1), new Date(y, m, d2),
    ].filter(d => d < dueDate).sort((a, b) => b - a);
    const assigned = candidates[0];
    if (!assigned) return { label: 'Past Due', color: PAYOUT_RED };
    return {
      label: fmtPayDate(assigned),
      color: assigned.getDate() === d2 ? PAYOUT_VIOLET : PAYOUT_BLUE,
    };
  }

  if (payoutSchedule.cycle === 'monthly') {
    const d = payoutSchedule.date || 30;
    const y = dueDate.getFullYear(), m = dueDate.getMonth();
    const candidates = [
      new Date(y, m - 1, d),
      new Date(y, m, d),
    ].filter(c => c < dueDate).sort((a, b) => b - a);
    const assigned = candidates[0];
    if (assigned) return { label: fmtPayDate(assigned), color: '#16A085' };
    return { label: `Monthly — ${ordinal(d)}`, color: '#16A085' };
  }

  return null;
}

const WEEK_DAYS_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_IDX = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };

// Add exactly 14 days to a YYYY-MM-DD string and return a new YYYY-MM-DD string.
function addFourteenDays(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + 14);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Returns true if the given YYYY-MM-DD date falls on the named weekday.
function dateMatchesWeekday(dateStr, weekdayName) {
  if (!dateStr || !weekdayName) return false;
  const d = new Date(dateStr + 'T00:00:00');
  return d.getDay() === DAY_IDX[weekdayName];
}

// Friendly date label — e.g. "Mon, Apr 6"
function fmtShortDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function AddRecurringModal({ open, onClose, onSave, currSymbol = "₱", payoutSchedule }) {
  const [form, setForm] = useState({ name: '', amount: '', due: '', nextDueDate: '', dueDay: 'Friday', freq: 'monthly' });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!open) { setBusy(false); setForm({ name: '', amount: '', due: '', nextDueDate: '', dueDay: 'Friday', freq: 'monthly' }); }
  }, [open]);

  const isBiWeekly = form.freq === 'bi-weekly';

  // For bi-weekly the "current" due is the user-entered next due date.
  // For monthly it's the standard date picker value.
  const effectiveDue = isBiWeekly ? form.nextDueDate : form.due;

  // Succeeding due = next due + 14 days
  const succeedingDue = isBiWeekly && form.nextDueDate ? addFourteenDays(form.nextDueDate) : '';

  // Validation: for bi-weekly, the chosen next-due-date must fall on the selected weekday
  const weekdayMismatch = isBiWeekly && form.nextDueDate && !dateMatchesWeekday(form.nextDueDate, form.dueDay);

  const prefundPreview = getPrefundPreview(effectiveDue, form.freq, payoutSchedule);
  // Also compute the payout for the succeeding due so we can show it
  const succeedingPrefund = succeedingDue ? getPrefundPreview(succeedingDue, form.freq, payoutSchedule) : null;

  const isValid = form.name.trim() && form.amount && (
    isBiWeekly ? (form.dueDay && form.nextDueDate && !weekdayMismatch) : form.due
  );

  const handleSave = async () => {
    if (!isValid) return;
    setBusy(true);
    try {
      const due = effectiveDue;
      const day = due ? new Date(due + 'T00:00:00').getDate() : 1;
      await onSave({
        name: form.name.trim(),
        amount: parseFloat(form.amount),
        day,
        cat: '',
        due,                          // next (current) payment date
        billingFreq: form.freq,       // 'monthly' | 'bi-weekly'
        ...(isBiWeekly && {
          dueDay: form.dueDay,        // weekday name, for future rolling
          nextDue: succeedingDue,     // the one after — pre-computed +14 days
        }),
      });
      setForm({ name: '', amount: '', due: '', nextDueDate: '', dueDay: 'Friday', freq: 'monthly' });
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

        {/* ── Payment Frequency dropdown ─────────────────────── */}
        <Field label="Payment Frequency">
          <div style={{ position: 'relative' }}>
            <select
              className="finput"
              value={form.freq}
              style={{ paddingRight: 36, appearance: 'none', WebkitAppearance: 'none' }}
              onChange={e => set('freq', e.target.value)}
              disabled={busy}
            >
              <option value="monthly">Monthly</option>
              <option value="bi-weekly">Bi-Weekly</option>
            </select>
            <div style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--accent)' }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
          </div>
        </Field>
      </div>

      {/* Due Day dropdown (bi-weekly) ↔ Due Date picker (monthly) */}
      {isBiWeekly ? (
        <Field label="Due Day">
          <div style={{ position: 'relative' }}>
            <select
              className="finput"
              value={form.dueDay}
              style={{ paddingRight: 36, appearance: 'none', WebkitAppearance: 'none' }}
              onChange={e => set('dueDay', e.target.value)}
              disabled={busy}
            >
              {WEEK_DAYS_FULL.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <div style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--accent)' }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
          </div>
        </Field>
      ) : (
        <Field label="Due Date">
          <input className="finput" type="date" value={form.due} onChange={e => set('due', e.target.value)} disabled={busy} />
        </Field>
      )}

      {/* ── Bi-weekly: next due date picker ───────────────────── */}
      {isBiWeekly && (
        <Field label="Next Due Date">
          <input
            className="finput"
            type="date"
            value={form.nextDueDate}
            onChange={e => set('nextDueDate', e.target.value)}
            disabled={busy}
            style={{ borderColor: weekdayMismatch ? 'var(--red)' : undefined }}
          />
          {weekdayMismatch && (
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--red)', marginTop: 5 }}>
              This date is not a {form.dueDay}. Please pick a {form.dueDay}.
            </div>
          )}
        </Field>
      )}


      {/* ── Projection card — bi-weekly only, shown when next due date is valid ── */}
      {isBiWeekly && effectiveDue && !weekdayMismatch && (
        <div style={{
          background: 'var(--surface2)', border: '1.5px solid var(--border)',
          borderRadius: 'var(--r2)', overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 800, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.7px' }}>
            Billing Projection
          </div>

          {/* Row 1 — current due */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--border)', gap: 10 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink3)', marginBottom: 2 }}>Next Payment</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>{fmtShortDate(effectiveDue)}</div>
            </div>
            {prefundPreview && (
              <span style={{
                fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0,
                background: prefundPreview.color + '18', color: prefundPreview.color,
                border: `1.5px solid ${prefundPreview.color}44`,
              }}>
                {prefundPreview.label}
              </span>
            )}
          </div>

          {/* Row 2 — succeeding due (+14 days) */}
          {succeedingDue && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', gap: 10 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink3)', marginBottom: 2 }}>Succeeding Payment</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>{fmtShortDate(succeedingDue)}</div>
              </div>
              {succeedingPrefund && (
                <span style={{
                  fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0,
                  background: succeedingPrefund.color + '18', color: succeedingPrefund.color,
                  border: `1.5px solid ${succeedingPrefund.color}44`,
                }}>
                  {succeedingPrefund.label}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Pre-fund preview for monthly ────────────────────── */}
      {!isBiWeekly && effectiveDue && prefundPreview && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          background: 'var(--surface2)', border: '1.5px solid var(--border)',
          borderRadius: 'var(--r2)', padding: '10px 14px',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)' }}>Pre-funded from</div>
          <span style={{
            fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 999, whiteSpace: 'nowrap',
            background: prefundPreview.color + '18', color: prefundPreview.color,
            border: `1.5px solid ${prefundPreview.color}44`,
          }}>
            {prefundPreview.label}
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button className="btn" style={{ flex: 1, justifyContent: 'center', borderRadius: 'var(--r2)' }} onClick={onClose} disabled={busy}>Cancel</button>
        <button
          className="btn btn-accent"
          style={{ flex: 1, justifyContent: 'center', opacity: busy ? 0.75 : 1, boxShadow: busy ? 'none' : undefined }}
          onClick={handleSave}
          disabled={busy || !isValid}
        >
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