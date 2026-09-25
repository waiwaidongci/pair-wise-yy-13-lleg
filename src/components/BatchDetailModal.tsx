import type { Batch } from '../domain/types';
import { useReservation, deliveryRisk } from '../state/ReservationContext';
import { Badge, BlockerTags, Modal, RiskTag } from './ui';
import { fmtDT, fmtMinutes } from '../utils/datetime';

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="kv-row">
      <dt>{k}</dt>
      <dd>{v ?? '—'}</dd>
    </div>
  );
}

export function BatchDetailModal({
  batch,
  onClose,
  onEdit,
  onPlace,
}: {
  batch: Batch;
  onClose: () => void;
  onEdit: (b: Batch) => void;
  onPlace: (b: Batch) => void;
}) {
  const { vats, rules, now, dispatch, operator, history } = useReservation();
  const vatName = (id?: string) => vats.find((v) => v.id === id)?.name ?? id ?? '—';
  const risk = deliveryRisk(batch, rules, now);
  const locked = batch.status === '开染' || batch.status === '完成';
  const logs = history.filter((h) => h.batchId === batch.id).slice(0, 8);

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={
        <span className="detail-title">
          批次 {batch.id} <Badge status={batch.status} /> {batch.rush && <span className="rush-flag">加急</span>}
        </span>
      }
      footer={
        <>
          <button onClick={() => onEdit(batch)} disabled={locked}>
            编辑档案{locked ? '（已锁定）' : ''}
          </button>
          {batch.status === '待排' && (
            <button className="primary" onClick={() => onPlace(batch)}>
              手动占位
            </button>
          )}
          {batch.status === '已排' && (
            <>
              <button onClick={() => onPlace(batch)}>调整排期</button>
              <button
                className="primary"
                onClick={() => dispatch({ type: 'markStarted', id: batch.id, operator })}
              >
                开染（锁定）
              </button>
            </>
          )}
          {batch.status === '待确认' && (
            <>
              <button onClick={() => onPlace(batch)}>选新缸/时刻重排</button>
              <button onClick={() => dispatch({ type: 'returnToPending', id: batch.id, operator })}>
                退回待排
              </button>
              <button
                className="primary"
                onClick={() => dispatch({ type: 'confirmReschedule', id: batch.id, operator })}
              >
                确认并沿用旧排期
              </button>
            </>
          )}
          {batch.status === '开染' && (
            <button className="primary" onClick={() => dispatch({ type: 'markDone', id: batch.id, operator })}>
              完工
            </button>
          )}
        </>
      }
    >
      <div className="detail-risk">
        交期风险：<RiskTag level={risk.level} /> <span className="muted">{risk.detail}</span>
        <span className="muted" style={{ marginLeft: 12 }}>
          交期 {fmtDT(batch.dueAt)}
        </span>
      </div>

      {batch.status === '待确认' && batch.held && (
        <div className="held-box">
          <b>⏸ 旧排期冻结：</b>
          {vatName(batch.held.slot.vatId)} · {fmtDT(batch.held.slot.start)} ~ {fmtDT(batch.held.slot.end)}
          <div className="held-reasons">
            退回原因：{batch.held.reasons.join('、')}
          </div>
          {batch.held.note && <div className="muted">{batch.held.note}</div>}
        </div>
      )}

      {batch.status === '待排' && batch.blockers && batch.blockers.length > 0 && (
        <BlockerTags blockers={batch.blockers} />
      )}

      <dl className="kv-grid">
        <Row k="订单号" v={batch.orderNo} />
        <Row k="客户" v={batch.customer} />
        <Row k="面料" v={batch.fabric} />
        <Row k="色差目标" v={batch.colorTarget || <span className="warn-text">未定（留待排）</span>} />
        <Row
          k="配方"
          v={
            <span>
              {batch.recipe.code} · {batch.recipe.composition}{' '}
              <span className={batch.recipe.reviewed ? 'ok-text' : 'warn-text'}>
                {batch.recipe.reviewed ? '✓ 已复核' : '⛔ 未复核'}
              </span>
            </span>
          }
        />
        <Row k="保温时间" v={fmtMinutes(batch.holdMinutes)} />
        <Row k="后整理" v={batch.finishing} />
        <Row k="预计染程" v={fmtMinutes(batch.durationMinutes)} />
        <Row
          k="当前排期"
          v={
            batch.slot ? (
              <>
                {vatName(batch.slot.vatId)} · {fmtDT(batch.slot.start)} ~ {fmtDT(batch.slot.end)}
                {batch.status === '开染' && <span className="lock-text"> 🔒 锁定</span>}
              </>
            ) : (
              '—'
            )
          }
        />
      </dl>

      <h4 className="detail-h">调整历史</h4>
      {logs.length === 0 ? (
        <div className="muted">暂无记录</div>
      ) : (
        <ul className="mini-log">
          {logs.map((h) => (
            <li key={h.id}>
              <span className="mini-log-time">{fmtDT(h.at)}</span>
              <span className={`mini-log-kind mk-${h.kind}`}>{h.kind}</span>
              <span>{h.detail}</span>
              <span className="muted">— {h.operator}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
