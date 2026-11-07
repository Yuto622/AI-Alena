import React from 'react';

export const Card: React.FC<React.PropsWithChildren<{ className?: string; title?: React.ReactNode; subtitle?: React.ReactNode }>> = ({ className = '', title, subtitle, children }) => (
  <section className={`glass rounded-2xl p-5 md:p-6 ${className}`}>
    {(title || subtitle) && (
      <header className="mb-4">
        {title && <h3 className="font-display text-lg md:text-xl font-bold text-white">{title}</h3>}
        {subtitle && <p className="text-sm text-slate-400 mt-1">{subtitle}</p>}
      </header>
    )}
    {children}
  </section>
);

export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'cream' }> = ({ variant = 'primary', className = '', children, ...rest }) => {
  const base = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all active:scale-[.98] disabled:opacity-40 disabled:cursor-not-allowed';
  const v = {
    primary: 'bg-brand-orange text-white hover:bg-orange-500 shadow-lg shadow-orange-900/30',
    ghost: 'bg-white/5 text-slate-100 hover:bg-white/10 border border-white/10',
    danger: 'bg-rose-600 text-white hover:bg-rose-500',
    cream: 'bg-brand-cream text-space-900 hover:bg-white',
  }[variant];
  return (
    <button className={`${base} ${v} ${className}`} {...rest}>
      {children}
    </button>
  );
};

export const Pill: React.FC<React.PropsWithChildren<{ tone?: 'orange' | 'green' | 'blue' | 'slate' | 'violet' }>> = ({ tone = 'slate', children }) => {
  const t = {
    orange: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    green: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    blue: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    violet: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
    slate: 'bg-white/5 text-slate-300 border-white/10',
  }[tone];
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
};

export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = ({ className = '', ...rest }) => (
  <input
    className={`w-full rounded-xl bg-space-900/80 border border-white/10 px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-orange/70 ${className}`}
    {...rest}
  />
);

export const Textarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = ({ className = '', ...rest }) => (
  <textarea
    className={`w-full rounded-xl bg-space-900/80 border border-white/10 px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-orange/70 custom-scrollbar ${className}`}
    {...rest}
  />
);

export const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: string }> = ({ label, value, hint }) => (
  <div className="rounded-xl bg-space-900/60 border border-white/5 p-4">
    <div className="text-xs text-slate-400">{label}</div>
    <div className="font-display text-2xl font-bold text-white mt-1">{value}</div>
    {hint && <div className="text-[11px] text-slate-500 mt-1">{hint}</div>}
  </div>
);

export const Spinner: React.FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" aria-hidden>
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);
