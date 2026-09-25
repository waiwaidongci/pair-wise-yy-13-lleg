import { useEffect, useMemo, useState } from 'react';
import type { Batch } from '../domain/types';
import {
  DAY_MS,
  HOUR_MS,
  earliestGap,
  overlap,
} from '../domain/scheduling';
import { useReservation } from '../state/ReservationContext';
import { Field, Modal, inputCls } from './ui';
import { fmtDT, fmtMinutes, fromLocalInput, toLocalInput } from '../utils/datetime';

export function PlaceModal({
  batch,
  onClose,
}: {
  batch: Batch;
  onClose: () => void;
}) {
  const { batches, vats, rules, now, dispatch, operator } = useReservation();
  const [vatId, setVatId] = useState(batch.slot?.vatId ?? batch.preferredVatId ?? vats.find((v) => v.active)?.id ?? '');
  const [startStr, setStartStr] = useState(toLocalInput(batch.slot?.start ?? now));

  useEffect(() => {
    setVatId(batch.slot?.vatId ?? batch.preferredVatId ?? vats.find((v) => v.active)?.id ?? '');
    setStartStr(toLocalInput(batch.slot?.start ?? now));
  }, [batch, vats, now]);

  const start = fromLocalInput(startStr) ?? now;
  const end = start + batch.durationMinutes * 60_000;

  const others = useMemo(
    () => batches.filter((b) => b.id !== batch.id && b.slot && overlap(b.slot, { vatId, start, end })),
    [batches, batch.id, vatId, start, end],
  );
  const heldOthers = useMemo(
    () =>
      batches.filter(
        (b) => b.id !== batch.id && b.held && overlap(b.held.slot, { vatId, start, end }),
      ),
    [batches, batch.id, vatId, start, end],
  );

  const anchorHit = others.filter((b) => b.status === '开染' || b.status === '完成');
  const plannedHit = others.filter((b) => b.status === '已排');
  const preemptible =
    batch.rush && rules.rushPreempt ? plannedHit.filter((b) => !b.rush) : [];
  const blockedPlanned = plannedHit.filter((b) => !preemptible.includes(b));

  const canSubmit = !anchorHit.length && !blockedPlanned.length && !heldOthers.length && vatId;

  const suggest = () => {
    const g = earliestGap(
      batch.durationMinutes,
      now,
      now + rules.horizonDays * DAY_MS,
      vats,
      batches,
      batch.preferredVatId,
      rules.slotStepMinutes,
    );
    if (!g) return;
    setVatId(g.slot.vatId);
    setStartStr(toLocalInput(g.slot.start));
  };

  const submit = () => {
    dispatch({ type: 'manualPlace', id: batch.id, vatId, start, operator });
    onClose();
  };

  const vat = vats.find((v) => v.id === vatId);

  return (
    <Modal
      open
      onClose={onClose}
      title={`手动占位 · ${batch.id}${batch.rush ? '（加急）' : ''}`}
      footer={
        <>
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={!canSubmit} onClick={submit}>
            确认占位
          </button>
        </>
      }
    >
      <div className="place-summary">
        <span>染程：{fmtMinutes(batch.durationMinutes)}</span>
        <span>交期：{fmtDT(batch.dueAt)}</span>
        {batch.slot && <span className="muted">现排期：{fmtDT(batch.slot.start)} 起</span>}
      </div>
      <div className="place-grid">
        <Field label="染缸">
          <select className={inputCls} value={vatId} onChange={(e) => setVatId(e.target.value)}>
            {vats.map((v) => (
              <option key={v.id} value={v.id} disabled={!v.active}>
                {v.name}（{v.spec}）{v.active ? '' : '· 停用'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="开始时刻" hint={`按 ${rules.slotStepMinutes} 分钟粒度吸附，结束 ${fmtDT(end)}`}>
          <input type="datetime-local" className={inputCls} value={startStr} onChange={(e) => setStartStr(e.target.value)} />
        </Field>
      </div>
      <button className="ghost" onClick={suggest}>
        🔎 查找窗口内最早可用空档
      </button>

      <div className="conflict-box">
        {anchorHit.length > 0 && (
          <div className="conflict-anchor">
            🔒 与已开染批次 {anchorHit.map((b) => b.id).join('、')} 时间重叠——已开染安排不可打乱，请另选时刻/染缸。
          </div>
        )}
        {heldOthers.length > 0 && (
          <div className="conflict-anchor">
            ⏸ 与待确认批次 {heldOthers.map((b) => b.id).join('、')} 冻结的旧排期重叠，请另选。
          </div>
        )}
        {blockedPlanned.length > 0 && (
          <div className="conflict-hard">
            ⛔ 与已排批次 {blockedPlanned.map((b) => `${b.id}${b.rush ? '(加急)' : ''}`).join('、')} 重叠
            {batch.rush && rules.rushPreempt ? '（加急单同样受保护，不能挤走加急单）' : '，非加急不能挤占'}。
          </div>
        )}
        {preemptible.length > 0 && (
          <div className="conflict-soft">
            ⚡ 启用加急提前：确认后 {preemptible.map((b) => b.id).join('、')} 将被挤回待排并记录原因。
          </div>
        )}
        {!others.length && !heldOthers.length && vat && (
          <div className="conflict-free">✓ {vat.name} 该时段无占用，可以占位。</div>
        )}
        {start < now - HOUR_MS && <div className="conflict-hard">开始时刻早于当前时间，将自动吸附到当前时间之后。</div>}
      </div>
    </Modal>
  );
}
