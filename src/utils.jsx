// src/utils.jsx

export const CATS = [];

export const peso = (n) =>
    '₱' + Math.round(n).toLocaleString('en-PH');

export const catTotals = (expenses) => {
    const m = {};
    expenses.forEach((e) => { m[e.cat] = (m[e.cat] || 0) + e.amount; });
    return m;
};

export const TIPS = {
    Food: 'Food leads your spending. Meal prepping can reduce costs by 20–25%.',
    Transport: 'Transport costs are elevated. Route consolidation and mixed transit can generate savings.',
    Shopping: 'Shopping is your top category. A 48-hour pause before discretionary purchases helps.',
    Bills: 'Fixed obligations dominate. Review and renegotiate service contracts annually.',
    Health: 'Health leads spend. Check if HMO or employer benefits cover some costs.',
    Fun: 'Entertainment is highest. A fixed monthly discretionary cap keeps this manageable.',
};

export function CatIcon({ name, size = 14 }) {
    const icons = {
        Food: (
            <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
                <path d="M7 2v5a3 3 0 01-3 3v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 2v3M7 2v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M13 2c0 0 3 2.5 3 6s-3 4-3 4v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        ),
        Transport: (
            <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
                <path d="M3 12l1.5-4.5A2 2 0 016.4 6h7.2a2 2 0 011.9 1.5L17 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <rect x="2" y="12" width="16" height="4" rx="2" stroke="currentColor" strokeWidth="1.8" />
                <circle cx="6" cy="16" r="1.5" fill="currentColor" />
                <circle cx="14" cy="16" r="1.5" fill="currentColor" />
            </svg>
        ),
        Shopping: (
            <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
                <path d="M6 7V5a4 4 0 018 0v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <rect x="3" y="7" width="14" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
                <path d="M8 11a2 2 0 004 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
        ),
        Bills: (
            <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
                <path d="M5 2h10a1 1 0 011 1v15l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L4 18V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M8 7h5M8 10.5h5M8 14h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
        ),
        Health: (
            <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
                <path d="M10 17S3 12.5 3 7.5a4 4 0 017-2.6A4 4 0 0117 7.5C17 12.5 10 17 10 17z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M6 10h2l1.5-2.5 2 5 1.5-2.5H15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        ),
        Fun: (
            <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
                <rect x="2" y="6" width="16" height="9" rx="4" stroke="currentColor" strokeWidth="1.8" />
                <path d="M7 9v4M5 11h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <circle cx="13" cy="10" r="1.1" fill="currentColor" />
                <circle cx="15" cy="12" r="1.1" fill="currentColor" />
            </svg>
        ),
        Other: (
            <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
                <circle cx="6" cy="6" r="2" stroke="currentColor" strokeWidth="1.7" />
                <circle cx="14" cy="6" r="2" stroke="currentColor" strokeWidth="1.7" />
                <circle cx="6" cy="14" r="2" stroke="currentColor" strokeWidth="1.7" />
                <circle cx="14" cy="14" r="2" stroke="currentColor" strokeWidth="1.7" />
            </svg>
        ),
    };
    return icons[name] || icons.Other;
}

export function TrashIcon({ size = 13 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
            {/* Handle */}
            <path d="M8 4h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            {/* Lid */}
            <path d="M3.5 7h13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            {/* Body */}
            <path d="M5 7l1 10a2 2 0 002 1.8h4A2 2 0 0014 17l1-10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            {/* Inner lines */}
            <path d="M8.5 10v5M11.5 10v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    );
}

export function InfoIcon({ size = 14 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.7" />
            <path d="M10 9v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="10" cy="6.5" r="1" fill="currentColor" />
        </svg>
    );
}

export function AlertIcon({ size = 11 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
            <path d="M10 3L2 17h16L10 3z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            <path d="M10 8v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="10" cy="14.5" r="1" fill="currentColor" />
        </svg>
    );
}

export function PlusIcon({ size = 11 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
            <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
    );
}

export function CloseIcon({ size = 13 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
    );
}

export function EditIcon({ size = 12 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
            <path d="M13 3l4 4-9 9H4v-4l9-9z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M11 5l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    );
}