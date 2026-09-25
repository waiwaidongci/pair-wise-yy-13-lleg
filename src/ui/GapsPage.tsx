import { useMemo, useState } from "react";
import { gapsOfDay } from "../domain/engine";
import { useStore } from "../store/store";
import { fmtDuration, toLocalInput } from "../domain/time";
import BookModal from "./BookModal";
import { Empty } from "./widgets";

export default function GapsPage() {
  const store = useStore();
  const [offset, setOffset] = useState(0);
  const [minFit, setMinFit] = useState(60);
  const [book, setBook] = useState<{ machineId: string; local: string } | null>(
    null
  );

  const day = new Date(store.now);
  day.setDate(day.getDate() + offset);
  day.setHours(0, 0, 0, 0);

  const gaps = useMemo(
    () =>
      gapsOfDay(store.state, day.toISOString())
        .filter((g) => g.fitMin >= minFit)
        .sort((a, b) => a.start.localeCompare(b.start)),
    [store.state, day, minFit]
  );

  const machineName = (id: string) =>
    store.state.machines.find((m) => m.id === id)?.name ?? id;

  const pending = store.state.batches.filter((b) => b.status === "pending").length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>空档视图</h2>
          <p className="sub">
            按工作时段与缸间缓冲计算的可排空档；空档长度按最短染程筛选，点「预约」直接占位。
          </p>
        </div>
        <div className="day-switch">
          <button onClick={() => setOffset((v) => v - 1)}>‹ 前一天</button>
          <strong>
            {day.getMonth() + 1}/{day.getDate()}
            {offset === 0 ? "（今天）" : ""}
          </strong>
          <button onClick={() => setOffset((v) => v + 1)}>后一天 ›</button>
          <button onClick={() => setOffset(0)}>回到今天</button>
        </div>
      </div>

      <div className="filters">
        <span className="muted">空档不短于（分钟）：</span>
        {[30, 60, 120, 240, 360].map((v) => (
          <button
            key={v}
            className={`chip ${minFit === v ? "chip-on" : ""}`}
            onClick={() => setMinFit(v)}
          >
            {v === 360 ? "6 小时" : fmtDuration(v)}
          </button>
        ))}
        <span className="spacer" />
        <span className="muted">当前待排批次 {pending} 个</span>
      </div>

      {gaps.length === 0 ? (
        <Empty text="该日没有满足条件的空档（可能排满或不在工作时段）" />
      ) : (
        <div className="gap-list">
          {gaps.map((g, i) => (
            <div className="gap-card" key={`${g.machineId}-${g.start}-${i}`}>
              <div className="gap-machine">{machineName(g.machineId)}</div>
              <div className="gap-time">
                {new Date(g.start).getHours()}:
                {String(new Date(g.start).getMinutes()).padStart(2, "0")}
                {" – "}
                {new Date(g.end).getHours()}:
                {String(new Date(g.end).getMinutes()).padStart(2, "0")}
                <small>
                  可容纳染程 {g.fitMin - store.state.rules.bufferMin} 分（含缓冲{" "}
                  {store.state.rules.bufferMin} 分）
                </small>
              </div>
              <div className="gap-bar">
                <span
                  style={{
                    left: `${
                      ((new Date(g.start).getTime() -
                        day.getTime() -
                        6 * 3600000) /
                        (16 * 3600000)) *
                      100
                    }%`,
                    width: `${
                      ((new Date(g.end).getTime() -
                        new Date(g.start).getTime()) /
                        (16 * 3600000)) *
                      100
                    }%`,
                  }}
                />
              </div>
              <button
                className="primary"
                onClick={() =>
                  setBook({ machineId: g.machineId, local: toLocalInput(new Date(g.start)) })
                }
              >
                预约此时段
              </button>
            </div>
          ))}
        </div>
      )}

      {book && (
        <BookModal
          machineId={book.machineId}
          startLocal={book.local}
          onClose={() => setBook(null)}
        />
      )}
    </div>
  );
}
