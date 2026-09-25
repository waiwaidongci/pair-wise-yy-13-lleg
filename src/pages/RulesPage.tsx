import { useState } from 'react';
import type { RuleSettings } from '../domain/types';
import { useReservation } from '../state/ReservationContext';
import { Field } from '../components/ui';

export function RulesPage() {
  const { rules, vats, dispatch, operator } = useReservation();
  const [draft, setDraft] = useState<RuleSettings>({ ...rules });
  const dirty = JSON.stringify(draft) !== JSON.stringify(rules);

  const set = <K extends keyof RuleSettings>(k: K, v: RuleSettings[K]) =>
    setDraft((p) => ({ ...p, [k]: v }));

  return (
    <div className="page rules-page">
      <div className="panel">
        <h3>排程规则</h3>
        <p className="muted rule-intro">
          规则与批次档案、页面各自维护：此处修改只影响后续排程计算，不直接改动任何已有排期；
          开染/完成批次为锚点，任何规则都不允许打乱它们。
        </p>
        <div className="rules-grid">
          <Field label="时间粒度（分钟）" hint="手动占位吸附刻度">
            <input
              type="number"
              className="inp"
              min={10}
              step={5}
              value={draft.slotStepMinutes}
              onChange={(e) => set('slotStepMinutes', Math.max(5, Number(e.target.value) || 30))}
            />
          </Field>
          <Field label="自动排程窗口（天）" hint="从当前时刻向前搜索空档">
            <input
              type="number"
              className="inp"
              min={1}
              max={30}
              value={draft.horizonDays}
              onChange={(e) => set('horizonDays', Math.max(1, Number(e.target.value) || 7))}
            />
          </Field>
          <Field label="交期临近预警（小时）" hint="交期在该小时数内→预警">
            <input
              type="number"
              className="inp"
              min={1}
              value={draft.riskSoonHours}
              onChange={(e) => set('riskSoonHours', Math.max(1, Number(e.target.value) || 24))}
            />
          </Field>
          <Field label="完工缓冲（小时）" hint="染程结束距交期不足该值→高风险">
            <input
              type="number"
              className="inp"
              min={0}
              value={draft.riskBufferHours}
              onChange={(e) => set('riskBufferHours', Math.max(0, Number(e.target.value) || 0))}
            />
          </Field>
        </div>
        <label className="check rule-check">
          <input
            type="checkbox"
            checked={draft.rushPreempt}
            onChange={(e) => set('rushPreempt', e.target.checked)}
          />
          <span>
            允许加急提前：加急批次无空档时，可把<b>普通已排</b>批次挤回待排（加急单与开染/完成批次受保护）
          </span>
        </label>
        <div className="rules-actions">
          <button onClick={() => setDraft({ ...rules })} disabled={!dirty}>
            还原
          </button>
          <button
            className="primary"
            disabled={!dirty}
            onClick={() => dispatch({ type: 'updateRules', rules: draft, operator })}
          >
            保存规则
          </button>
        </div>
      </div>

      <div className="panel">
        <h3>染缸台账（机器）</h3>
        <p className="muted rule-intro">停用维护中的染缸不参与排程；其在制批次与历史排期保留。</p>
        <table className="vat-table">
          <thead>
            <tr>
              <th>染缸</th>
              <th>规格</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {vats.map((v) => (
              <tr key={v.id}>
                <td><b>{v.name}</b></td>
                <td className="muted">{v.spec}</td>
                <td>
                  <span className={v.active ? 'ok-text' : 'warn-text'}>
                    {v.active ? '启用中' : '停用维护'}
                  </span>
                </td>
                <td>
                  <button onClick={() => dispatch({ type: 'toggleVat', vatId: v.id, operator })}>
                    {v.active ? '停用维护' : '恢复启用'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel rule-logic">
        <h3>规则说明（引擎内置，不可在页面关闭）</h3>
        <ul>
          <li>同一染缸时间区间重叠即冲突；<b>开染/完成批次是锚点，任何排程、加急、确认操作都不能移动它们</b>。</li>
          <li>色差目标未定、配方未复核、期望缸时与现有安排重叠的批次一律留在<b>待排</b>并标注原因。</li>
          <li>自动排程顺序：加急优先 → 交期先后 → 登记先后；只放入开染锚点之间的空档。</li>
          <li>配方、保温时间、后整理、染程时长被修改时，已排/待确认批次<b>退回待确认</b>，旧排期冻结保留并记录原因。</li>
          <li>待确认批次确认时旧排期若已与锚点或其他安排冲突，必须退回待排重新占位。</li>
        </ul>
      </div>
    </div>
  );
}
