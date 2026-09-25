import { useState } from "react";
import type { Machine, Rules } from "../domain/types";
import { useStore } from "../store/store";
import { Field } from "./widgets";

function minToHM(v: number | null): string {
  if (v === null) return "";
  const h = Math.floor(v / 60);
  const m = v % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function hmToMin(s: string): number | null {
  if (!s) return null;
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

export default function RulesPage() {
  const store = useStore();
  const r0 = store.state.rules;
  const [f, setF] = useState<Rules>({ ...r0 });
  const [allDay, setAllDay] = useState(r0.workStartMin === null);
  const [msg, setMsg] = useState<string | null>(null);

  const set = (patch: Partial<Rules>) => setF((v) => ({ ...v, ...patch }));

  const save = () => {
    const rules: Rules = {
      ...f,
      workStartMin: allDay ? null : hmToMin(minToHM(f.workStartMin ?? 420)),
      workEndMin: allDay ? null : hmToMin(minToHM(f.workEndMin ?? 1320)),
    };
    if (
      !allDay &&
      rules.workStartMin !== null &&
      rules.workEndMin !== null &&
      rules.workEndMin <= rules.workStartMin
    ) {
      setMsg("工作时段结束需晚于开始");
      return;
    }
    store.saveRules(rules);
    setMsg("规则已保存；不符合新规则的已排批次已退回待确认（开染中的不受影响）");
  };

  return (
    <div className="page rules-page">
      <div className="page-head">
        <div>
          <h2>排程规则</h2>
          <p className="sub">
            规则独立于批次维护。修改保存后会立即复核现有排期：冲突批次退回待确认并保留旧排期与原因；开染中的安排绝不动。
          </p>
        </div>
      </div>

      {msg && <div className="info-bar">{msg}</div>}

      <section className="panel">
        <h3>排产参数</h3>
        <div className="form-grid-2">
          <Field label="缸间缓冲（分钟）" hint="清缸/转产时间，计入占位">
            <input
              className="ctl"
              type="number"
              min={0}
              step={5}
              value={f.bufferMin}
              onChange={(e) => set({ bufferMin: Number(e.target.value) })}
            />
          </Field>
          <Field label="排产周期（天）">
            <input
              className="ctl"
              type="number"
              min={1}
              max={30}
              value={f.horizonDays}
              onChange={(e) => set({ horizonDays: Number(e.target.value) })}
            />
          </Field>
          <Field label="排程刻度（分钟）" hint="开始时刻必须对齐">
            <input
              className="ctl"
              type="number"
              min={5}
              max={120}
              step={5}
              value={f.slotStepMin}
              onChange={(e) => set({ slotStepMin: Number(e.target.value) })}
            />
          </Field>
          <Field label="交期预警（小时）" hint="缓冲低于该值提示">
            <input
              className="ctl"
              type="number"
              min={1}
              step={1}
              value={f.warnBeforeDueHours}
              onChange={(e) => set({ warnBeforeDueHours: Number(e.target.value) })}
            />
          </Field>
          <Field label="每日工作时段">
            <div className="inline-ctl">
              <label className="check">
                <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
                24 小时全天
              </label>
              {!allDay && (
                <>
                  <input
                    className="ctl slim"
                    type="time"
                    value={minToHM(f.workStartMin)}
                    onChange={(e) => set({ workStartMin: hmToMin(e.target.value) })}
                  />
                  <span>至</span>
                  <input
                    className="ctl slim"
                    type="time"
                    value={minToHM(f.workEndMin)}
                    onChange={(e) => set({ workEndMin: hmToMin(e.target.value) })}
                  />
                </>
              )}
            </div>
          </Field>
        </div>
        <div className="dl-actions">
          <button className="primary" onClick={save}>
            保存并复核现有排期
          </button>
        </div>
      </section>

      <MachinesPanel />
    </div>
  );
}

function MachinesPanel() {
  const store = useStore();
  const [editing, setEditing] = useState<Machine | null>(null);

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>染缸台账</h3>
        <button
          className="ghost"
          onClick={() =>
            setEditing({
              id: `M${Date.now().toString(36).toUpperCase()}`,
              name: "",
              enabled: true,
              note: "",
            })
          }
        >
          新增染缸
        </button>
      </div>
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>编号</th>
              <th>名称</th>
              <th>适用面料</th>
              <th>状态</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {store.state.machines.map((m) => (
              <tr key={m.id}>
                <td>{m.id}</td>
                <td>{m.name}</td>
                <td className="muted">{m.note}</td>
                <td>{m.enabled ? "启用" : "停用"}</td>
                <td className="ops">
                  <button className="ghost" onClick={() => setEditing({ ...m })}>
                    编辑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <div className="modal-mask" onMouseDown={() => setEditing(null)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>染缸资料</h3>
              <button className="icon-btn" onClick={() => setEditing(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <Field label="名称" required>
                  <input
                    className="ctl"
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  />
                </Field>
                <Field label="适用面料/备注">
                  <input
                    className="ctl"
                    value={editing.note}
                    onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                  />
                </Field>
                <Field label="启用状态">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={editing.enabled}
                      onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                    />
                    参与排程
                  </label>
                </Field>
              </div>
              <div className="dl-actions">
                <button
                  className="primary"
                  onClick={() => {
                    if (!editing.name.trim()) return;
                    store.saveMachine(editing);
                    setEditing(null);
                  }}
                >
                  保存
                </button>
                <button onClick={() => setEditing(null)}>取消</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
