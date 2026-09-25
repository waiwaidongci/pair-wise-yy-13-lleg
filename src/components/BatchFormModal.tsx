import { useEffect, useState } from 'react';
import type { Batch } from '../domain/types';
import { useReservation, emptyDraft, draftFromBatch, type BatchDraft } from '../state/ReservationContext';
import { Field, Modal, inputCls } from './ui';
import { fromLocalInput, toLocalInput } from '../utils/datetime';

export function BatchFormModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing?: Batch | null;
}) {
  const { vats, dispatch, operator } = useReservation();
  const [d, setD] = useState<BatchDraft>(emptyDraft());
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setD(editing ? draftFromBatch(editing) : emptyDraft());
      setError('');
    }
  }, [open, editing]);

  const set = <K extends keyof BatchDraft>(k: K, v: BatchDraft[K]) =>
    setD((prev) => ({ ...prev, [k]: v }));

  const locked = editing?.status === '开染' || editing?.status === '完成';

  const submit = () => {
    if (!d.orderNo.trim()) return setError('请填写订单号');
    if (!d.fabric.trim()) return setError('请填写面料');
    if (!d.recipeCode.trim()) return setError('请填写配方编号');
    if (!d.durationMinutes || d.durationMinutes <= 0) return setError('预计染程时长需大于 0');
    if (editing) {
      dispatch({ type: 'updateBatch', id: editing.id, draft: d, operator });
    } else {
      dispatch({ type: 'addBatch', draft: d, operator });
    }
    onClose();
  };

  const triggerWarn =
    editing && (editing.status === '已排' || editing.status === '待确认');

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={editing ? `编辑批次 ${editing.id}` : '批次登记'}
      footer={
        <>
          {locked && <span className="form-locked">已开染/完成批次的工艺不可修改</span>}
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={submit} disabled={locked}>
            {editing ? '保存变更' : '登记入档'}
          </button>
        </>
      }
    >
      {error && <div className="form-error">{error}</div>}
      {triggerWarn && (
        <div className="form-warn">
          注意：修改 <b>配方 / 保温时间 / 后整理 / 染程时长</b> 后，该批次将<b>退回待确认</b>，
          系统保留旧排期与变更原因，需确认后才恢复排期。
        </div>
      )}
      <fieldset disabled={locked} className="form-grid">
        <Field label="订单号" required>
          <input className={inputCls} value={d.orderNo} onChange={(e) => set('orderNo', e.target.value)} placeholder="如 SO-2409-130" />
        </Field>
        <Field label="客户">
          <input className={inputCls} value={d.customer} onChange={(e) => set('customer', e.target.value)} placeholder="如 华盛服饰" />
        </Field>
        <Field label="面料" required hint="成分/组织/克重">
          <input className={inputCls} value={d.fabric} onChange={(e) => set('fabric', e.target.value)} placeholder="如 涤棉 65/35 双面布 180g/㎡" />
        </Field>
        <Field label="色差目标" hint="留空=未定，进待排">
          <input className={inputCls} value={d.colorTarget} onChange={(e) => set('colorTarget', e.target.value)} placeholder="如 ΔE ≤ 1.0（D65）" />
        </Field>
        <Field label="配方编号" required>
          <input className={inputCls} value={d.recipeCode} onChange={(e) => set('recipeCode', e.target.value)} placeholder="如 RF-2060" />
        </Field>
        <Field label="配方组成">
          <input className={inputCls} value={d.recipeComposition} onChange={(e) => set('recipeComposition', e.target.value)} placeholder="如 活性红 1.2% / 元明粉 40g/L" />
        </Field>
        <Field label="保温时间（分钟）">
          <input type="number" className={inputCls} value={d.holdMinutes} onChange={(e) => set('holdMinutes', Number(e.target.value))} />
        </Field>
        <Field label="预计染程（分钟）" required hint="决定占位时长">
          <input type="number" className={inputCls} value={d.durationMinutes} onChange={(e) => set('durationMinutes', Number(e.target.value))} />
        </Field>
        <Field label="后整理方式">
          <input className={inputCls} value={d.finishing} onChange={(e) => set('finishing', e.target.value)} placeholder="如 柔软定型 150℃×3min" />
        </Field>
        <Field label="交期">
          <input
            type="datetime-local"
            className={inputCls}
            value={toLocalInput(d.dueAt)}
            onChange={(e) => set('dueAt', fromLocalInput(e.target.value))}
          />
        </Field>
        <Field label="期望染缸（可选）" hint="仅用于登记时试排">
          <select className={inputCls} value={d.preferredVatId} onChange={(e) => set('preferredVatId', e.target.value)}>
            <option value="">不指定</option>
            {vats.filter((v) => v.active).map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}（{v.spec}）
              </option>
            ))}
          </select>
        </Field>
        <Field label="期望开始时刻（可选）">
          <input
            type="datetime-local"
            className={inputCls}
            value={toLocalInput(d.preferredStart)}
            onChange={(e) => set('preferredStart', fromLocalInput(e.target.value))}
          />
        </Field>
        <div className="check-row">
          <label className="check">
            <input type="checkbox" checked={d.recipeReviewed} onChange={(e) => set('recipeReviewed', e.target.checked)} />
            <span>配方已由工艺员复核</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={d.rush} onChange={(e) => set('rush', e.target.checked)} />
            <span>加急单（排程优先，可提前占用普通已排批次）</span>
          </label>
        </div>
      </fieldset>
    </Modal>
  );
}
