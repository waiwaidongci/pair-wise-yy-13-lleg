import { useMemo, useState } from 'react';
import type { Batch, BatchStatus } from '../domain/types';
import { useReservation, deliveryRisk } from '../state/ReservationContext';
import { Badge, BlockerTags, Empty, RiskTag } from '../components/ui';
import { fmtDT, fmtMinutes } from '../utils/datetime';

type StatusFilter = BatchStatus | '全部';

export function BatchesPage({
  onOpenBatch,
  onNew,
}: {
  onOpenBatch: (b: Batch) => void;
  onNew: () => void;
}) {
  const { batches, vats, rules, now } = useReservation();
  const [status, setStatus] = useState<StatusFilter>('全部');
  const [kw, setKw] = useState('');
  const [rushOnly, setRushOnly] = useState(false);

  const filtered = useMemo(() => {
    const q = kw.trim().toLowerCase();
    return batches
      .filter((b) => (status === '全部' ? true : b.status === status))
      .filter((b) => (rushOnly ? b.rush : true))
      .filter((b) =>
        !q
          ? true
          : [b.id, b.orderNo, b.customer ?? '', b.fabric, b.recipe.code]
              .join(' ')
              .toLowerCase()
              .includes(q),
      )
      .sort((a, b) => {
        if (a.rush !== b.rush) return a.rush ? -1 : 1;
        return a.dueAt - b.dueAt;
      });
  }, [batches, status, kw, rushOnly]);

  const tabs: StatusFilter[] = ['全部', '待排', '已排', '待确认', '开染', '完成'];
  const vatName = (id?: string) => vats.find((v) => v.id === id)?.name ?? id ?? '—';

  return (
    <div className="page">
      <div className="list-toolbar panel">
        <div className="tabs">
          {tabs.map((t) => (
            <button
              key={t}
              className={status === t ? 'tab on' : 'tab'}
              onClick={() => setStatus(t)}
            >
              {t}
              <em>{t === '全部' ? batches.length : batches.filter((b) => b.status === t).length}</em>
            </button>
          ))}
        </div>
        <div className="list-tools-right">
          <input
            className="inp inp-search"
            placeholder="搜索批次号 / 订单 / 客户 / 面料 / 配方"
            value={kw}
            onChange={(e) => setKw(e.target.value)}
          />
          <label className="check">
            <input type="checkbox" checked={rushOnly} onChange={(e) => setRushOnly(e.target.checked)} />
            只看加急
          </label>
          <button className="primary" onClick={onNew}>
            + 批次登记
          </button>
        </div>
      </div>

      <div className="batch-list">
        {filtered.length === 0 && <Empty text="没有符合条件的批次" />}
        {filtered.map((b) => {
          const risk = deliveryRisk(b, rules, now);
          return (
            <article key={b.id} className="batch-card panel" onClick={() => onOpenBatch(b)}>
              <div className="bc-main">
                <div className="bc-head">
                  <button className="bc-id" onClick={(e) => { e.stopPropagation(); onOpenBatch(b); }}>
                    {b.id}
                  </button>
                  <Badge status={b.status} />
                  {b.rush && <span className="rush-flag">加急</span>}
                  <RiskTag level={risk.level} />
                </div>
                <div className="bc-line">
                  <b>{b.orderNo}</b>
                  {b.customer && <span className="muted">· {b.customer}</span>}
                </div>
                <div className="bc-fabric">{b.fabric}</div>
                <div className="bc-tags">
                  <span className="tag">色差：{b.colorTarget || <i className="warn-text">未定</i>}</span>
                  <span className="tag">
                    配方 {b.recipe.code}
                    <span className={b.recipe.reviewed ? 'ok-text' : 'warn-text'}>
                      {b.recipe.reviewed ? ' ✓已复核' : ' ⛔未复核'}
                    </span>
                  </span>
                  <span className="tag">保温 {fmtMinutes(b.holdMinutes)}</span>
                  <span className="tag">染程 {fmtMinutes(b.durationMinutes)}</span>
                  {b.finishing && <span className="tag">{b.finishing}</span>}
                </div>
                {b.status === '待排' && <BlockerTags blockers={b.blockers} />}
                {b.status === '待确认' && b.held && (
                  <div className="bc-held">
                    ⏸ 旧排期保留：{vatName(b.held.slot.vatId)} {fmtDT(b.held.slot.start)} 起 ｜原因：
                    {b.held.reasons.join('、')}
                  </div>
                )}
              </div>
              <div className="bc-side">
                <div>
                  <small>排期</small>
                  <b>{b.slot ? vatName(b.slot.vatId) : '—'}</b>
                  <span>{b.slot ? fmtDT(b.slot.start) : '尚未占位'}</span>
                </div>
                <div>
                  <small>交期</small>
                  <span>{fmtDT(b.dueAt)}</span>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
