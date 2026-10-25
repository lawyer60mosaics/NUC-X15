import type { CSSProperties, ReactNode } from 'react';

export type StudioPage = 'home' | 'ec' | 'performance' | 'display' | 'keyboard' | 'lightbar' | 'monitor';

export function StudioIcon({ name, size = 30 }: { name: 'gear' | 'fan' | 'performance' | 'display' | 'keyboard' | 'lightbar' | 'monitor' | 'battery'; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 48 48', fill: 'none', stroke: 'currentColor', strokeWidth: 2.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const };
  if (name === 'gear') return <svg {...common}><path d="M20 4h8l1.5 5.5 4 2.2 5.4-1.4 4 7-4 4 0 4.6 4 4-4 7-5.4-1.4-4 2.2L28 44h-8l-1.5-5.5-4-2.2-5.4 1.4-4-7 4-4v-4.6l-4-4 4-7 5.4 1.4 4-2.2z"/><circle cx="24" cy="24" r="7"/></svg>;
  if (name === 'fan') return <svg {...common}><circle cx="24" cy="24" r="4"/><path d="M23 19C13 5 9 17 19 22M28 23c17-3 12 10 1 6M22 28c-7 16-15 7-6-1"/><circle cx="24" cy="24" r="19" opacity=".55"/></svg>;
  if (name === 'performance') return <svg {...common}><path d="M5 26c2-12 13-20 25-17l-5 8 17 0-9 12 1-7-13 0 4-6C16 15 9 20 5 26Z"/><circle cx="24" cy="25" r="12"/><path d="M24 25l7-8"/></svg>;
  if (name === 'display') return <svg {...common}><rect x="5" y="7" width="38" height="27" rx="2"/><path d="M17 41h14M24 34v7"/></svg>;
  if (name === 'keyboard') return <svg {...common}><rect x="4" y="10" width="40" height="27" rx="2"/><path d="M9 16h30M9 21h30M9 26h30M14 32h20"/></svg>;
  if (name === 'lightbar') return <svg {...common}><rect x="3" y="20" width="42" height="8" rx="1" fill="currentColor" stroke="none"/></svg>;
  if (name === 'battery') return <svg {...common}><rect x="8" y="12" width="31" height="28" rx="3"/><path d="M18 12V7h11v5M41 18h4v14h-4"/><path d="M13 18h21v17H13z" fill="currentColor" stroke="none"/></svg>;
  return <svg {...common}><rect x="4" y="5" width="40" height="38" rx="3"/><path d="M4 24h9l4-12 7 24 5-13 3 5h12"/></svg>;
}

export function StudioSwitch({ checked, onChange, disabled = false, label }: { checked: boolean | null; onChange?: (value: boolean) => void; disabled?: boolean; label: string }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked == null ? undefined : checked} disabled={disabled || !onChange} className={`nss-switch ${checked ? 'is-on' : ''} ${checked == null ? 'is-unknown' : ''}`} title={disabled || !onChange ? '当前控制接口尚未接入或状态不可读' : undefined} onClick={() => onChange?.(!checked)}><span>{checked == null ? '—' : checked ? '开' : '关'}</span><i /></button>;
}

export function StudioRing({ label, value, temperature, color = 'cyan' }: { label?: string; value: number | null; temperature?: number | '--'; color?: 'cyan' | 'orange' | 'green' }) {
  const percent = value == null ? 0 : Math.min(100, Math.max(0, value));
  return <div className="nss-ring-block"><div className={`nss-ring nss-ring-${color}`} style={{ '--ring-percent': `${percent}%` } as CSSProperties}><span>{value == null ? '—' : `${Math.round(value)}%`}</span></div>{label && <strong>{label}</strong>}{temperature != null && <small>♧ {temperature === '--' ? '--' : `${temperature}°C`}</small>}</div>;
}

export function FanReadout({ label, rpm }: { label: string; rpm: number | '--' }) {
  return <div className="nss-fan-readout"><span className="nss-fan-wheel" aria-hidden="true">✣</span><span>{label}：<br /><strong>{rpm === '--' ? '--' : rpm} RPM</strong></span></div>;
}

const keyboardRows = [
  ['ESC', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'INS', 'SCR', 'DEL'],
  ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'BACK', 'HOME'],
  ['TAB', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\', 'PGUP'],
  ['CAPS', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'ENTER', 'PGDN'],
  ['SHIFT', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', 'SHIFT', '↑', 'END'],
  ['CTRL', 'FN', '⊞', 'ALT', 'SPACE', 'ALT', 'CTRL', '←', '↓', '→'],
];

export function StudioKeyboardArt({ compact = false }: { compact?: boolean }) {
  return <div className={`nss-keyboard-art ${compact ? 'is-compact' : ''}`} aria-label="键盘布局示意图" role="img">{keyboardRows.map((row, rowIndex) => <div className="nss-keyboard-row" key={rowIndex}>{row.map((key, index) => <span key={`${key}-${index}`} className={key === 'SPACE' ? 'is-space' : key.length > 3 ? 'is-wide' : ''}>{key}</span>)}</div>)}</div>;
}

export function StudioPageFrame({ title, icon, onHome, children, action }: { title: string; icon: 'fan' | 'performance' | 'display' | 'keyboard' | 'lightbar'; onHome: () => void; children: ReactNode; action?: ReactNode }) {
  return <div className="nss-detail-page"><div className="nss-breadcrumb"><button type="button" onClick={onHome}>◀ 主页</button><span>› {title}</span></div><section className="nss-detail-panel"><div className="nss-detail-heading"><StudioIcon name={icon} size={49} /><h1>{title}</h1>{action}</div><div className="nss-detail-body">{children}</div></section></div>;
}

export function Unsupported({ children }: { children: ReactNode }) {
  return <span className="nss-unsupported" title="当前底层接口未验证，暂不能操作">{children}</span>;
}
