import { useMemo, useState } from 'react';
import { DAY_MS, vatGaps } from '../domain/scheduling';
import { useReservation } from '../state/ReservationContext';
import { fmtDT, fmtMDHM, fmtMinutes } from '../utils/datetime';

export function GapsPage() {
  const { batches, vats, now } = useReservation();
  const [dayOffset, setDayOffset] = useState(0);
  const [needMinutes, setNeedMinutes] = useState(300);
  const [vatId, setVatId] = useState('');

  const windowStart = useMemo(() => {
    const d = new Date(now + dayOffset * DAY_MS);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, [now, dayOffset]);
  const windowEnd = windowStart + DAY_MS;

  const targetVats = vats.filter((v) => v.active && (!vatId || v.id === vatId));

  const rows = targetVats.map((v) => {
    const gaps = vatGaps(v.id, Math.max(windowStart, now), windowEnd, batches, true)
      .map((g) => ({ ...g, fit: g.minutes >= needMinutes }))
      .filter((g) => g.minutes >= 30);
    return { vat: v, gaps };
  });

  const totalFit = rows.reduce((n, r) => n + r.gaps.filter((g) => g.fit).length, 0);

  return (
    <div className="page">
      <div className="panel gap-controls">
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
        <label className="field inline-field">
          <span className="field-label">染缸</span>
          <select className="inp" value={vatId} onChange={(e) => setVatId(e.target.value)}>
            <option value="">全部启用染缸</option>
            {vats.map((v) => (
              <option key={v.id} value={v.id} disabled={!v.active}>
                {v.name}{v.active ? '' : '（停用）'}
              </option>
            ))}
          </select>
        </label>
        <label className="field inline-field">
          <span className="field-label">染程需求</span>
          <input
            type="number"
            className="inp"
            value={needMinutes}
            min={30}
            step={30}
            onChange={(e) => setNeedMinutes(Math.max(30, Number(e.target.value) || 0))}
          />
          <small>分钟</small>
        </label>
        <span className="gap-summary">
          可容纳 <b>{fmtMinutes(needMinutes)}</b> 的空档：<b>{totalFit}</b> 段
          <br />
          <small className="muted">空档仅绕开「开染/完成」锚点——这些安排绝不动；已排批次可由加急提前挤退重排。</small>
        </span>
      </div>

      <div className="gap-rows">
        {rows.map(({ vat, gaps }) => (
          <div key={vat.id} className="panel gap-row">
            <div className="gap-vat">
              <b>{vat.name}</b>
              <small>{vat.spec}</small>
            </div>
            <div className="gap-segments">
              {gaps.length === 0 && <span className="muted">当日无 30 分钟以上空档</span>}
              {gaps.map((g, i) => (
                <span key={i} className={`seg ${g.fit ? 'seg-fit' : 'seg-small'}`} title={`${fmtDT(g.start)} ~ ${fmtDT(g.end)}`}>
                  {fmtMDHM(g.start)}–{fmtMDHM(g.end)}
                  <em>{fmtMinutes(g.minutes)}</em>
                  {g.fit && <i>可排</i>}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
