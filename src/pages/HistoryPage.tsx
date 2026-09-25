import { useMemo, useState } from 'react';
import type { HistoryKind } from '../domain/types';
import { useReservation } from '../state/ReservationContext';
import { fmtDT } from '../utils/datetime';
import { Empty } from '../components/ui';

const KINDS: (HistoryKind | '全部')[] = [
  '全部',
  '登记',
  '自动排程',
  '手动占位',
  '加急提前',
  '退回待确认',
  '确认重排',
  '开染',
  '完成',
  '编辑',
  '规则变更',
  '染缸维护',
];

export function HistoryPage({ onOpenBatch }: { onOpenBatch: (id: string) => void }) {
  const { history, batches } = useReservation();
  const [kind, setKind] = useState<HistoryKind | '全部'>('全部');
  const [kw, setKw] = useState('');

  const list = useMemo(() => {
    const q = kw.trim().toLowerCase();
    return history.filter((h) => (kind === '全部' ? true : h.kind === kind)).filter((h) =>
      !q
        ? true
        : [h.detail, h.batchId ?? '', h.operator, h.before ?? '', h.after ?? ''].join(' ').toLowerCase().includes(q),
    );
  }, [history, kind, kw]);

  const batchExists = (id?: string) => batches.some((b) => b.id === id);

  return (
    <div className="page">
      <div className="panel history-toolbar">
        <div className="tabs">
          {KINDS.map((k) => (
            <button key={k} className={kind === k ? 'tab on' : 'tab'} onClick={() => setKind(k)}>
              {k}
            </button>
          ))}
        </div>
        <input
          className="inp inp-search"
          placeholder="搜索操作内容 / 批次 / 操作人"
          value={kw}
          onChange={(e) => setKw(e.target.value)}
        />
      </div>

      <div className="panel">
        {list.length === 0 ? (
          <Empty text="暂无调整记录" />
        ) : (
          <ul className="history-list">
            {list.map((h) => (
              <li key={h.id} className="history-item">
                <div className="hi-time">{fmtDT(h.at)}</div>
                <span className={`mini-log-kind mk-${h.kind}`}>{h.kind}</span>
                <div className="hi-body">
                  <div>{h.detail}</div>
                  {(h.before || h.after) && (
                    <div className="hi-diff">
                      {h.before && <div><span className="muted">前：</span>{h.before}</div>}
                      {h.after && <div><span className="muted">后：</span>{h.after}</div>}
                    </div>
                  )}
                  <div className="hi-meta">
                    <span className="muted">{h.operator}</span>
                    {h.batchId && batchExists(h.batchId) && (
                      <button className="link-btn" onClick={() => onOpenBatch(h.batchId!)}>
                        查看 {h.batchId} →
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
