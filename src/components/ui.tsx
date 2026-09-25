import { useEffect, type ReactNode } from 'react';
import type { BatchStatus, Blocker } from '../domain/types';
import type { RiskLevel } from '../domain/scheduling';

export const STATUS_STYLE: Record<BatchStatus, string> = {
  待排: 'st-pending',
  已排: 'st-planned',
  待确认: 'st-held',
  开染: 'st-running',
  完成: 'st-done',
};

export const RISK_STYLE: Record<RiskLevel, string> = {
  已逾期: 'rk-overdue',
  高风险: 'rk-high',
  预警: 'rk-soon',
  正常: 'rk-ok',
  无排期: 'rk-none',
};

export function Badge({ status }: { status: BatchStatus }) {
  return <span className={`badge ${STATUS_STYLE[status]}`}>{status}</span>;
}

export function RiskTag({ level }: { level: RiskLevel }) {
  return <span className={`risk-tag ${RISK_STYLE[level]}`}>{level}</span>;
}

export function BlockerTags({ blockers }: { blockers?: Blocker[] }) {
  if (!blockers?.length) return null;
  return (
    <div className="blocker-tags">
      {blockers.map((b, i) => (
        <span key={i} className={`blocker bl-${b.kind}`} title={b.detail}>
          ⛔ {b.kind}
        </span>
      ))}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  wide,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  wide?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-mask" onMouseDown={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {required && <em>*</em>}
        {hint && <small>{hint}</small>}
      </span>
      {children}
    </label>
  );
}

export const inputCls = 'inp';

export function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}
