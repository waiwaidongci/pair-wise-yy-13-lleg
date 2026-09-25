import { useMemo, useState } from "react";
import type { Batch, Slot } from "../domain/types";
import { blocks, readiness } from "../domain/engine";
import { useStore } from "../store/store";
import { StatusBadge, RushTag, Modal, Field } from "./widgets";
import BookModal from "./BookModal";
import { fmtDateTime, fmtDuration, toLocalInput } from "../domain/time";

const HOURS = Array.from({ length: 16 }, (_, i) => 6 + i); // 06:00–21:00 刻度

type Selection =
  | { kind: "block"; batchId: string }
  | { kind: "gap"; machineId: string; startLocal: string }
  | null;

function dayBase(dayKey: string): Date {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function pct(ms: number): number {
  return (ms / (16 * 3600000)) * 100;
}

export default function BoardPage() {
  const store = useStore();
  const today = store.now;
  const [dayOffset, setDayOffset] = useState(0);
  const day = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + dayOffset,
    0,
    0,
    0,
    0
  );
  const windowStart = new Date(day);
  windowStart.setHours(6, 0, 0, 0);
  const windowEnd = new Date(day);
  windowEnd.setHours(22, 0, 0, 0);

  const [sel, setSel] = useState<Selection>(null);

  const dayIso = day.toISOString();
  const dayBlocks = useMemo(
    () =>
      blocks(store.state).filter((b) => {
        const bs = new Date(b.start);
        return (
          bs.getFullYear() === day.getFullYear() &&
          bs.getMonth() === day.getMonth() &&
          bs.getDate() === day.getDate()
        );
      }),
    [store.state, dayIso]
  );

  const batchById = useMemo(() => {
    const m = new Map<string, Batch>();
    store.state.batches.forEach((b) => m.set(b.id, b));
    return m;
  }, [store.state.batches]);

  const nowPct =
    today >= windowStart && today <= windowEnd
      ? pct(today.getTime() - windowStart.getTime())
      : null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>染缸预约白板</h2>
          <p className="sub">
            按染缸 × 开始时刻占位；点空位预约，点色块查看/操作。斜线块为待确认（保留旧排期）。
          </p>
        </div>
        <div className="day-switch">
          <button onClick={() => setDayOffset((v) => v - 1)}>‹ 前一天</button>
          <strong>
            {day.getMonth() + 1}/{day.getDate()}
            {dayOffset === 0 ? "（今天）" : ""}
          </strong>
          <button onClick={() => setDayOffset((v) => v + 1)}>后一天 ›</button>
          <button onClick={() => setDayOffset(0)}>回到今天</button>
        </div>
      </div>

      <div className="legend">
        <span className="lg st-running">开染中·锁定</span>
        <span className="lg st-scheduled">已排</span>
        <span className="lg st-review">待确认·旧排期</span>
        <span className="lg st-done">已完成</span>
      </div>

      <div className="board">
        <div className="board-corner">染缸 ＼ 时刻</div>
        <div className="board-hours">
          {HOURS.map((h) => (
            <div key={h} className="hour-col">
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>

        {store.state.machines.map((m) => (
          <Row
            key={m.id}
            machineId={m.id}
            machineName={m.name}
            machineNote={m.note}
            enabled={m.enabled}
            blocks={dayBlocks.filter((b) => b.machineId === m.id)}
            batchById={batchById}
            windowStart={windowStart}
            windowEnd={windowEnd}
            nowPct={nowPct}
            onBlock={(id) => setSel({ kind: "block", batchId: id })}
            onGap={(start) =>
              setSel({
                kind: "gap",
                machineId: m.id,
                startLocal: toLocalInput(start),
              })
            }
          />
        ))}
      </div>

      {sel?.kind === "block" && (
        <BlockDialog
          batch={batchById.get(sel.batchId)}
          onClose={() => setSel(null)}
        />
      )}
      {sel?.kind === "gap" && (
        <BookModal
          machineId={sel.machineId}
          startLocal={sel.startLocal}
          onClose={() => setSel(null)}
        />
      )}
    </div>
  );
}

function Row({
  machineName,
  machineNote,
  enabled,
  blocks: rowBlocks,
  batchById,
  windowStart,
  windowEnd,
  onBlock,
  onGap,
}: {
  machineId: string;
  machineName: string;
  machineNote: string;
  enabled: boolean;
  blocks: ReturnType<typeof blocks>;
  batchById: Map<string, Batch>;
  windowStart: Date;
  windowEnd: Date;
  nowPct: number | null;
  onBlock: (id: string) => void;
  onGap: (start: Date) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <>
      <div className={`machine-cell ${enabled ? "" : "off"}`}>
        <b>{machineName}</b>
        <small>{machineNote}</small>
      </div>
      <div
        className={`track ${enabled ? "" : "track-off"}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          if (!enabled) return;
          const rect = e.currentTarget.getBoundingClientRect();
          setHover(((e.clientX - rect.left) / rect.width) * 100);
        }}
        onClick={(e) => {
          if (!enabled) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;
          const t = windowStart.getTime() + ratio * 16 * 3600000;
          // 对齐 15 分钟刻度
          const step = 15 * 60000;
          const snapped = new Date(Math.round(t / step) * step);
          if (snapped < windowStart || snapped >= windowEnd) return;
          onGap(snapped);
        }}
      >
        {HOURS.map((h) => (
          <span key={h} className="gridline" style={{ left: `${((h - 6) / 16) * 100}%` }} />
        ))}
        {hover !== null && enabled && <span className="hoverline" style={{ left: `${hover}%` }} />}
        {rowBlocks.map((b) => {
          const batch = batchById.get(b.batchId);
          if (!batch) return null;
          const left = pct(b.start - windowStart.getTime());
          const width = pct(b.jobEnd - b.start);
          const cls =
            b.status === "running"
              ? "blk-running"
              : b.status === "review"
              ? "blk-review"
              : b.status === "done"
              ? "blk-done"
              : "blk-scheduled";
          return (
            <button
              key={b.batchId}
              className={`blk ${cls}`}
              style={{ left: `${left}%`, width: `${Math.max(width, 1.6)}%` }}
              title={`${b.batchId} ${fmtDateTime(new Date(b.start).toISOString())} 起，${fmtDuration(
                (b.jobEnd - b.start) / 60000
              )}`}
              onClick={(e) => {
                e.stopPropagation();
                onBlock(b.batchId);
              }}
            >
              <span className="blk-id">
                {b.batchId}
                {batch.rush && " ⚡"}
              </span>
              <span className="blk-time">
                {new Date(b.start).getHours()}:
                {String(new Date(b.start).getMinutes()).padStart(2, "0")}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function BlockDialog({
  batch,
  onClose,
}: {
  batch: Batch | undefined;
  onClose: () => void;
}) {
  const store = useStore();
  const [err, setErr] = useState<string | null>(null);
  if (!batch) return null;
  const slot: Slot | null = batch.slot ?? batch.previousSlot;
  const machine = store.state.machines.find((m) => m.id === slot?.machineId);
  const chk = readiness(batch);

  const run = (fn: () => string | null) => {
    const e = fn();
    if (e) setErr(e);
    else onClose();
  };

  return (
    <Modal title={`批次 ${batch.id}`} onClose={onClose}>
      <div className="dl-grid">
        <div>
          <small>状态</small>
          <div>
            <StatusBadge status={batch.status} /> {batch.rush && <RushTag />}
          </div>
        </div>
        <div>
          <small>订单 / 客户</small>
          <b>
            {batch.orderNo} · {batch.customer}
          </b>
        </div>
        <div>
          <small>面料</small>
          <b>{batch.fabric}</b>
        </div>
        <div>
          <small>色差目标 ΔE≤</small>
          <b>{batch.colorTarget ?? "未定"}</b>
        </div>
        <div>
          <small>配方</small>
          <b>
            {batch.process.recipeNo || "（无）"} ·{" "}
            {batch.process.recipeReviewed ? "已复核" : "未复核"}
          </b>
        </div>
        <div>
          <small>染程 / 保温</small>
          <b>
            {fmtDuration(batch.process.durationMin)} /{" "}
            {fmtDuration(batch.process.holdMin)}
          </b>
        </div>
        <div>
          <small>后整理</small>
          <b>{batch.process.finish || "—"}</b>
        </div>
        <div>
          <small>交期</small>
          <b>{fmtDateTime(batch.dueAt)}</b>
        </div>
      </div>

      {slot && (
        <div className={`slot-box ${batch.status === "review" ? "slot-review" : ""}`}>
          {batch.status === "review" ? "保留的旧排期：" : "当前排期："}
          {machine?.name}，{fmtDateTime(slot.startAt)} – {fmtDateTime(slot.endAt)}
          {batch.status === "review" && batch.previousSlot && (
            <div className="reason">原因：{batch.previousSlot.reason}</div>
          )}
        </div>
      )}

      {!chk.ready && (
        <div className="warn-box">上机前缺项：{chk.reasons.join("、")}</div>
      )}

      {err && <div className="err-box">{err}</div>}

      <div className="dl-actions">
        {batch.status === "scheduled" && (
          <button className="primary" onClick={() => run(() => store.startDye(batch.id))}>
            开染（锁定排期）
          </button>
        )}
        {batch.status === "running" && (
          <button className="primary" onClick={() => run(() => store.completeDye(batch.id))}>
            染整完工
          </button>
        )}
        {batch.status === "review" && (
          <>
            <button
              className="primary"
              disabled={!chk.ready}
              onClick={() => run(() => store.resolveReview(batch.id, "keep"))}
            >
              复核无误·保留旧排期
            </button>
            <button onClick={() => run(() => store.resolveReview(batch.id, "reschedule"))}>
              重新自动改约
            </button>
            <button className="danger" onClick={() => run(() => store.resolveReview(batch.id, "release"))}>
              释放·退回待排
            </button>
          </>
        )}
        {(batch.status === "pending" || batch.status === "scheduled" || batch.status === "review") && (
          <ProcessEditor batch={batch} onDone={onClose} />
        )}
      </div>
      {batch.note && <p className="note-line">备注：{batch.note}</p>}
    </Modal>
  );
}

function ProcessEditor({ batch, onDone }: { batch: Batch; onDone: () => void }) {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    recipeNo: batch.process.recipeNo,
    recipeReviewed: batch.process.recipeReviewed,
    durationMin: batch.process.durationMin,
    holdMin: batch.process.holdMin,
    finish: batch.process.finish,
  });
  const [err, setErr] = useState<string | null>(null);

  if (!open) return <button onClick={() => setOpen(true)}>工艺/配方变更…</button>;

  const save = () => {
    const e = store.changeProcess(batch.id, { ...form });
    if (e) setErr(e);
    else {
      setOpen(false);
      onDone();
    }
  };

  return (
    <div className="inline-edit">
      <div className="inline-grid">
        <Field label="配方编号">
          <input
            className="ctl"
            value={form.recipeNo}
            onChange={(e) => setForm({ ...form, recipeNo: e.target.value })}
          />
        </Field>
        <Field label="配方复核">
          <select
            className="ctl"
            value={form.recipeReviewed ? "1" : "0"}
            onChange={(e) => setForm({ ...form, recipeReviewed: e.target.value === "1" })}
          >
            <option value="0">未复核</option>
            <option value="1">已复核</option>
          </select>
        </Field>
        <Field label="预计染程（分）">
          <input
            className="ctl"
            type="number"
            min={0}
            step={15}
            value={form.durationMin}
            onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) })}
          />
        </Field>
        <Field label="保温时间（分）">
          <input
            className="ctl"
            type="number"
            min={0}
            step={5}
            value={form.holdMin}
            onChange={(e) => setForm({ ...form, holdMin: Number(e.target.value) })}
          />
        </Field>
        <Field label="后整理">
          <input
            className="ctl"
            value={form.finish}
            onChange={(e) => setForm({ ...form, finish: e.target.value })}
          />
        </Field>
      </div>
      {err && <div className="err-box">{err}</div>}
      <div className="inline-actions">
        <button className="primary" onClick={save}>
          保存变更
        </button>
        <button onClick={() => setOpen(false)}>取消</button>
        <small className="muted">已排批次保存后将退回待确认，旧排期与原因保留</small>
      </div>
    </div>
  );
}
