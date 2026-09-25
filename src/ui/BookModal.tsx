import { useState } from "react";
import { useStore } from "../store/store";
import { readiness } from "../domain/engine";
import { Modal, Field, Empty } from "./widgets";

/** 用指定染缸与开始时刻为待排/待确认批次手动占位 */
export default function BookModal({
  machineId,
  startLocal,
  onClose,
}: {
  machineId: string;
  startLocal: string;
  onClose: () => void;
}) {
  const store = useStore();
  const candidates = store.state.batches.filter(
    (b) => b.status === "pending" || b.status === "review"
  );
  const [batchId, setBatchId] = useState("");
  const [mId, setMId] = useState(machineId);
  const [start, setStart] = useState(startLocal);
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    if (!batchId) {
      setErr("请选择批次");
      return;
    }
    const e = store.manualBook(batchId, mId, start);
    if (e) setErr(e);
    else onClose();
  };

  return (
    <Modal title="空位预约" onClose={onClose}>
      <div className="form-grid">
        <Field label="批次" required>
          <select className="ctl" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
            <option value="">请选择待排/待确认批次</option>
            {candidates.map((b) => {
              const chk = readiness(b);
              return (
                <option key={b.id} value={b.id}>
                  {b.id} · {b.orderNo} · {b.fabric}
                  {chk.ready ? "" : `（${chk.reasons.join("/")}）`}
                </option>
              );
            })}
          </select>
        </Field>
        <Field label="染缸" required>
          <select className="ctl" value={mId} onChange={(e) => setMId(e.target.value)}>
            {store.state.machines
              .filter((m) => m.enabled)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="开始时刻" required hint="对齐排程刻度">
          <input
            className="ctl"
            type="datetime-local"
            step={Math.max(1, store.state.rules.slotStepMin / 60) * 60}
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </Field>
      </div>
      {candidates.length === 0 && <Empty text="没有待排批次，可先到「批次档案」登记" />}
      {err && <div className="err-box">{err}</div>}
      <div className="dl-actions">
        <button className="primary" onClick={submit}>
          确认占位
        </button>
        <button onClick={onClose}>取消</button>
      </div>
    </Modal>
  );
}
