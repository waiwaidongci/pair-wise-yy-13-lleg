import { useMemo } from "react";
import { risks } from "../domain/engine";
import { useStore } from "../store/store";
import { StatusBadge, RushTag, Empty } from "./widgets";
import { fmtDateTime, fmtDuration } from "../domain/time";

export default function RisksPage() {
  const store = useStore();
  const list = useMemo(
    () => risks(store.state, store.now.toISOString()),
    [store.state, store.now]
  );

  const danger = list.filter((r) => r.level === "danger");
  const warn = list.filter((r) => r.level === "warn");

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>交期风险</h2>
          <p className="sub">
            已排批次按预计完工对比交期；待排批次用“最早可排空档”预测；待确认批次单独提示。
          </p>
        </div>
      </div>

      <div className="risk-summary">
        <div className="risk-count danger-bg">
          <strong>{danger.length}</strong>
          <span>脱期 / 无空档</span>
        </div>
        <div className="risk-count warn-bg">
          <strong>{warn.length}</strong>
          <span>缓冲不足（{store.state.rules.warnBeforeDueHours} 小时）</span>
        </div>
      </div>

      {list.length === 0 ? (
        <Empty text="当前没有交期风险批次" />
      ) : (
        <div className="risk-list">
          {list.map((r) => {
            const b = store.state.batches.find((x) => x.id === r.batchId)!;
            const slot = b.slot ?? b.previousSlot;
            return (
              <div key={b.id} className={`risk-card ${r.level}`}>
                <div className="risk-main">
                  <div className="risk-title">
                    <b>{b.id}</b> <RushTag />
                    <StatusBadge status={b.status} />
                    {r.level === "danger" ? (
                      <span className="risk-tag danger-tag">脱期风险</span>
                    ) : (
                      <span className="risk-tag warn-tag">临近交期</span>
                    )}
                  </div>
                  <div className="risk-desc">
                    {b.orderNo} · {b.customer} · {b.fabric}
                  </div>
                  <div className="risk-msg">{r.message}</div>
                </div>
                <div className="risk-meta">
                  <div>
                    <small>交期</small>
                    <b>{fmtDateTime(b.dueAt)}</b>
                  </div>
                  <div>
                    <small>预计/旧排期完工</small>
                    <b>{slot ? fmtDateTime(slot.endAt) : "未排"}</b>
                  </div>
                  <div>
                    <small>染程</small>
                    <b>{fmtDuration(b.process.durationMin)}</b>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
