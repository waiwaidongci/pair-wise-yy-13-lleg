import type { BatchStatus } from "../domain/types";
import { statusLabel } from "../domain/engine";
import type { ReactNode } from "react";

const STATUS_CLASS: Record<BatchStatus, string> = {
  pending: "st-pending",
  scheduled: "st-scheduled",
  review: "st-review",
  running: "st-running",
  done: "st-done",
};

export function StatusBadge({ status }: { status: BatchStatus }) {
  return <span className={`badge ${STATUS_CLASS[status]}`}>{statusLabel(status)}</span>;
}

export function RushTag() {
  return <span className="rush-tag">加急</span>;
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="modal-mask" onMouseDown={onClose}>
      <div
        className={`modal ${wide ? "modal-wide" : ""}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
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

export const inputCls = "ctl";

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="toast">{message}</div>;
}

export function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}
