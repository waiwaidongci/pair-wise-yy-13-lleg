import { useMemo, useState } from "react";
import { useStore } from "../store/store";
import { Empty } from "./widgets";
import { fmtDateTime } from "../domain/time";

const TYPE_LABELS: Record<string, string> = {
  register: "批次登记",
  book: "手动占位",
  "auto-schedule": "自动排程",
  "auto-schedule-summary": "自动排程",
  "schedule-skip": "排程跳过",
  rush: "加急插单",
  "rush-shift": "插单移位",
  start: "开染",
  complete: "完工",
  "process-change": "工艺变更",
  "review-return": "规则复核退回",
  "review-resolve": "待确认处理",
  "rules-change": "规则变更",
  "machine-change": "染缸台账",
};

const TYPE_COLORS: Record<string, string> = {
  register: "t-neutral",
  book: "t-blue",
  "auto-schedule": "t-blue",
  "auto-schedule-summary": "t-blue",
  "schedule-skip": "t-amber",
  rush: "t-red",
  "rush-shift": "t-amber",
  start: "t-green",
  complete: "t-neutral",
  "process-change": "t-purple",
  "review-return": "t-amber",
  "review-resolve": "t-blue",
  "rules-change": "t-purple",
  "machine-change": "t-neutral",
};

export default function HistoryPage() {
  const store = useStore();
  const [type, setType] = useState("all");
  const [batchId, setBatchId] = useState("");

  const types = useMemo(() => {
    const s = new Set(store.logs.map((l) => l.type));
    return Array.from(s);
  }, [store.logs]);

  const list = store.logs.filter((l) => {
    if (type !== "all" && l.type !== type) return false;
    if (batchId && l.batchId !== batchId) return false;
    return true;
  });

  const batches = Array.from(
    new Set(store.logs.map((l) => l.batchId).filter(Boolean) as string[])
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>调整历史</h2>
          <p className="sub">
            所有排程动作、工艺/规则变更与加急移位都留痕，记录保留旧排期快照与原因。
          </p>
        </div>
        <button className="ghost danger-text" onClick={() => {
          if (confirm("恢复演示数据并清空本地修改？")) store.resetDemo();
        }}>
          重置演示数据
        </button>
      </div>

      <div className="filters">
        <button className={`chip ${type === "all" ? "chip-on" : ""}`} onClick={() => setType("all")}>
          全部类型
        </button>
        {types.map((t) => (
          <button
            key={t}
            className={`chip ${type === t ? "chip-on" : ""}`}
            onClick={() => setType(t)}
          >
            {TYPE_LABELS[t] ?? t}
          </button>
        ))}
        <span className="spacer" />
        <select className="ctl slim" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
          <option value="">全部批次</option>
          {batches.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </div>

      {list.length === 0 ? (
        <Empty text="没有匹配的历史记录" />
      ) : (
        <ol className="timeline">
          {list.map((l) => (
            <li key={l.id} className="tl-item">
              <span className={`tl-dot ${TYPE_COLORS[l.type] ?? "t-neutral"}`} />
              <div className="tl-body">
                <div className="tl-head">
                  <span className={`tl-type ${TYPE_COLORS[l.type] ?? "t-neutral"}`}>
                    {TYPE_LABELS[l.type] ?? l.type}
                  </span>
                  {l.batchId && <span className="tl-batch">{l.batchId}</span>}
                  <span className="tl-ts">{fmtDateTime(l.ts)}</span>
                </div>
                <div className="tl-msg">{l.message}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
