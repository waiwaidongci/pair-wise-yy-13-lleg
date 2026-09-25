import { useMemo, useState } from 'react';
import type { Batch, Vat } from '../domain/types';
import { DAY_MS, HOUR_MS, vatGaps } from '../domain/scheduling';
import { useReservation, deliveryRisk } from '../state/ReservationContext';
import { Badge, RiskTag } from '../components/ui';
import { fmtDT, fmtMDHM, fmtMinutes } from '../utils/datetime';

const HOUR_PX = 18; // 每小时 18px
const ROW_H = 46;

export function SchedulePage({
  onOpenBatch,
}: {
  onOpenBatch: (b: Batch) => void;
}) {
  const { batches, vats, rules, now, dispatch, operator } = useReservation();
  const [dayOffset, setDayOffset] = useState(0);

  const windowStart = useMemo(() => {
    const d = new Date(now + dayOffset * DAY_MS);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, [now, dayOffset]);
  const windowEnd = windowStart + DAY_MS;

  const activeVats = vats.filter((v) => v.active);

  const visible = batches
    .filter((b) => b.slot && b.slot.end > windowStart && b.slot.start < windowEnd)
    .sort((a, b) => a.slot!.start - b.slot!.start);

  // KPI / 风险统计（全局）
  const counts = { 待排: 0, 已排: 0, 待确认: 0, 开染: 0, 完成: 0 } as Record<Batch['status'], number>;
  for (const b of batches) counts[b.status]++;
  const riskBuckets = { 已逾期: [] as Batch[], 高风险: [] as Batch[], 预警: [] as Batch[] };
  for (const b of batches) {
    const r = deliveryRisk(b, rules, now);
    if (r.level === '已逾期' || r.level === '高风险' || r.level === '预警') riskBuckets[r.level].push(b);
  }

  const hours = 24;
  const timelineWidth = hours * HOUR_PX;

  const pos = (t: number) => ((t - windowStart) / HOUR_MS) * HOUR_PX;

  const gapsByVat = (v: Vat) =>
    vatGaps(v.id, Math.max(windowStart, now), windowEnd, batches, true).filter(
      (g) => g.minutes >= 30 && g.end - Math.max(windowStart, now) >= 30 * 60_000,
    );

  return (
    <div className="page">
      <div className="kpi-row">
        <div className="kpi k-pending">
          <strong>{counts.待排}</strong>
          <span>待排批次</span>
          <small>色差/配方/机器受限</small>
        </div>
        <div className="kpi k-held">
          <strong>{counts.待确认}</strong>
          <span>待确认</span>
          <small>工艺变更冻结旧排期</small>
        </div>
        <div className="kpi k-running">
          <strong>{counts.开染}</strong>
          <span>开染中</span>
          <small>排期已锁定</small>
        </div>
        <div className="kpi k-risk">
          <strong>{riskBuckets.已逾期.length + riskBuckets.高风险.length + riskBuckets.预警.length}</strong>
          <span>交期风险</span>
          <small>
            逾期 {riskBuckets.已逾期.length} · 高 {riskBuckets.高风险.length} · 预警 {riskBuckets.预警.length}
          </small>
        </div>
      </div>

      <div className="board-panel">
        <div className="board-toolbar">
          <div className="day-switch">
            <button onClick={() => setDayOffset((d) => d - 1)}>‹ 前一天</button>
            <button className={dayOffset === 0 ? 'today-btn on' : 'today-btn'} onClick={() => setDayOffset(0)}>
              {dayOffset === 0 ? '今天' : '回到今天'}
            </button>
            <button onClick={() => setDayOffset((d) => d + 1)}>后一天 ›</button>
            <span className="day-label">
              {new Date(windowStart).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}
            </span>
          </div>
          <button className="primary" onClick={() => dispatch({ type: 'autoSchedule', operator })}>
            ⚙ 一键自动排程（加急优先 · 不碰开染缸）
          </button>
        </div>

        <div className="gantt-scroll">
          <div className="gantt" style={{ width: 132 + timelineWidth }}>
            <div className="gantt-head" style={{ width: timelineWidth, marginLeft: 132 }}>
              {Array.from({ length: hours }, (_, h) => (
                <div key={h} className="tick" style={{ left: h * HOUR_PX, width: HOUR_PX }}>
                  {String(h).padStart(2, '0')}
                </div>
              ))}
            </div>

            {activeVats.map((v) => {
              const items = visible.filter((b) => b.slot!.vatId === v.id);
              const gaps = gapsByVat(v);
              return (
                <div key={v.id} className="gantt-row" style={{ width: 132 + timelineWidth }}>
                  <div className="vat-cell">
                    <b>{v.name}</b>
                    <small>{v.spec}</small>
                  </div>
                  <div className="track" style={{ width: timelineWidth, height: ROW_H }}>
                    {Array.from({ length: hours }, (_, h) => (
                      <div key={h} className={`grid-line ${h % 6 === 0 ? 'major' : ''}`} style={{ left: h * HOUR_PX }} />
                    ))}
                    {windowStart < now && now < windowEnd && (
                      <div className="now-line" style={{ left: pos(now) }} title="当前时刻" />
                    )}
                    {gaps.map((g, i) => {
                      const left = pos(Math.max(g.start, windowStart));
                      const width = Math.max(0, pos(Math.min(g.end, windowEnd)) - left);
                      if (width < 4) return null;
                      return (
                        <div
                          key={i}
                          className="gap-block"
                          style={{ left, width }}
                          title={`空档 ${fmtMDHM(g.start)}~${fmtDT(g.end)} 共 ${fmtMinutes(g.minutes)}`}
                        >
                          {width > 60 && <span>空档 {fmtMinutes(g.minutes)}</span>}
                        </div>
                      );
                    })}
                    {items.map((b) => {
                      const left = pos(Math.max(b.slot!.start, windowStart));
                      const width = Math.max(8, pos(Math.min(b.slot!.end, windowEnd)) - pos(Math.max(b.slot!.start, windowStart)));
                      const risk = deliveryRisk(b, rules, now);
                      return (
                        <button
                          key={b.id}
                          className={`batch-block bb-${b.status} ${b.held ? 'is-held' : ''}`}
                          style={{ left, width }}
                          onClick={() => onOpenBatch(b)}
                          title={`${b.id}｜${b.orderNo}｜${b.fabric}\n${fmtDT(b.slot!.start)} ~ ${fmtDT(b.slot!.end)}`}
                        >
                          <span className="bb-id">{b.id}</span>
                          {width > 90 && <span className="bb-meta">{b.orderNo}</span>}
                          {width > 150 && (
                            <span className={`bb-dot ${risk.level === '已逾期' || risk.level === '高风险' ? 'danger' : risk.level === '预警' ? 'warn' : ''}`} />
                          )}
                          {b.rush && <span className="bb-rush">急</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {vats.filter((v) => !v.active).map((v) => (
              <div key={v.id} className="gantt-row inactive-row" style={{ width: 132 + timelineWidth }}>
                <div className="vat-cell">
                  <b>{v.name}</b>
                  <small>停用维护</small>
                </div>
                <div className="track track-off" style={{ width: timelineWidth, height: ROW_H }} />
              </div>
            ))}
          </div>
        </div>
        <div className="legend">
          <span><i className="lg lg-running" />开染（锁定）</span>
          <span><i className="lg lg-planned" />已排</span>
          <span><i className="lg lg-held" />待确认（旧排期冻结）</span>
          <span><i className="lg lg-done" />完成</span>
          <span><i className="lg lg-gap" />空档</span>
          <span className="muted">点击色块查看批次详情；自动排程只会使用空档，绝不移动开染/完成安排。</span>
        </div>
      </div>

      <div className="risk-panel">
        <h3>交期风险</h3>
        {(['已逾期', '高风险', '预警'] as const).map((lv) => (
          <div key={lv} className="risk-group">
            <div className="risk-group-head">
              <RiskTag level={lv} />
              <span className="muted">{riskBuckets[lv].length} 个批次</span>
            </div>
            {riskBuckets[lv].length === 0 && <div className="muted risk-empty">无</div>}
            {riskBuckets[lv].map((b) => {
              const r = deliveryRisk(b, rules, now);
              return (
                <button key={b.id} className="risk-item" onClick={() => onOpenBatch(b)}>
                  <span className="risk-id">{b.id}</span>
                  <Badge status={b.status} />
                  <span className="risk-fabric">{b.fabric}</span>
                  <span className="muted">
                    {b.slot ? `完工 ${fmtDT(b.slot.end)}` : '无排期'} · 交期 {fmtDT(b.dueAt)}
                  </span>
                  <span className="muted">{r.detail}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
