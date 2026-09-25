import { useMemo, useState } from "react";
import type { BatchInput } from "../domain/types";
import { earliestSlot, readiness } from "../domain/engine";
import { useStore } from "../store/store";
import { StatusBadge, RushTag, Modal, Field, Empty } from "./widgets";
import { fmtDateTime, fmtDuration, fromLocalInput, toLocalInput } from "../domain/time";

const FABRICS = ["棉", "涤纶", "锦纶", "混纺"];

type Filter = "all" | "pending" | "review" | "scheduled" | "running" | "done";

export default function BatchesPage() {
  const store = useStore();
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [keyword, setKeyword] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const b of store.state.batches) c[b.status] = (c[b.status] ?? 0) + 1;
    return c;
  }, [store.state.batches]);

  const list = store.state.batches.filter((b) => {
    if (filter !== "all" && b.status !== filter) return false;
    if (orderNo && b.orderNo !== orderNo) return false;
    if (keyword) {
      const k = keyword.toLowerCase();
      return (
        b.id.toLowerCase().includes(k) ||
        b.customer.toLowerCase().includes(k) ||
        b.fabric.toLowerCase().includes(k) ||
        b.orderNo.toLowerCase().includes(k)
      );
    }
    return true;
  });

  const orders = Array.from(new Set(store.state.batches.map((b) => b.orderNo)));

  const flash = (e: string | null, ok = "已执行") =>
    setMsg(e ?? ok);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>批次档案</h2>
          <p className="sub">登记订单、面料、色差目标与预计染程；资料不齐的批次自动留在待排。</p>
        </div>
        <div className="head-actions">
          <button className="ghost" onClick={() => store.autoSchedule()}>
            一键自动排程
          </button>
          <button className="primary" onClick={() => setShowForm(true)}>
            登记新批次
          </button>
        </div>
      </div>

      {msg && (
        <div className="info-bar" onClick={() => setMsg(null)}>
          {msg}
        </div>
      )}

      <div className="filters">
        {(
          [
            ["all", "全部", store.state.batches.length],
            ["pending", "待排", counts.pending ?? 0],
            ["review", "待确认", counts.review ?? 0],
            ["scheduled", "已排", counts.scheduled ?? 0],
            ["running", "开染中", counts.running ?? 0],
            ["done", "已完成", counts.done ?? 0],
          ] as [Filter, string, number][]
        ).map(([k, label, n]) => (
          <button
            key={k}
            className={`chip ${filter === k ? "chip-on" : ""}`}
            onClick={() => setFilter(k)}
          >
            {label} <em>{n}</em>
          </button>
        ))}
        <span className="spacer" />
        <select className="ctl slim" value={orderNo} onChange={(e) => setOrderNo(e.target.value)}>
          <option value="">全部订单</option>
          {orders.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        <input
          className="ctl slim"
          placeholder="搜索批次/客户/面料"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>

      {list.length === 0 ? (
        <Empty text="没有符合条件的批次" />
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>批次</th>
                <th>订单 / 客户</th>
                <th>面料</th>
                <th>色差目标</th>
                <th>配方</th>
                <th>染程</th>
                <th>交期</th>
                <th>排期</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((b) => (
                <BatchRow key={b.id} batchId={b.id} onMsg={flash} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <RegisterModal
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            setMsg("批次已登记，若资料齐全可参与排程");
          }}
        />
      )}
    </div>
  );
}

function BatchRow({
  batchId,
  onMsg,
}: {
  batchId: string;
  onMsg: (e: string | null, ok?: string) => void;
}) {
  const store = useStore();
  const b = store.state.batches.find((x) => x.id === batchId)!;
  const chk = readiness(b);
  const slot = b.slot ?? b.previousSlot;
  const machine = store.state.machines.find((m) => m.id === slot?.machineId);

  const earliest =
    b.status === "pending" && chk.ready
      ? earliestSlot(store.state, b, { fromIso: store.now.toISOString() })
      : null;

  return (
    <tr className={b.status === "review" ? "row-review" : ""}>
      <td>
        <b>{b.id}</b>
        {b.rush && <RushTag />}
      </td>
      <td>
        {b.orderNo}
        <small className="block">{b.customer}</small>
      </td>
      <td>{b.fabric}</td>
      <td className={b.colorTarget === null ? "cell-bad" : ""}>
        {b.colorTarget === null ? "未定" : `ΔE≤${b.colorTarget}`}
      </td>
      <td className={b.process.recipeReviewed ? "" : "cell-bad"}>
        {b.process.recipeNo || "—"}
        <small className="block">
          {b.process.recipeReviewed ? "已复核" : "未复核"}
        </small>
      </td>
      <td>
        {fmtDuration(b.process.durationMin)}
        <small className="block">保温 {fmtDuration(b.process.holdMin)}</small>
      </td>
      <td>{fmtDateTime(b.dueAt)}</td>
      <td>
        {slot ? (
          <>
            {machine?.name.split("（")[0]}
            <small className="block">
              {fmtDateTime(slot.startAt)}
              {b.status === "review" && "（旧）"}
            </small>
          </>
        ) : earliest ? (
          <span className="muted">
            最早 {fmtDateTime(earliest.startAt)}
          </span>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td>
        <StatusBadge status={b.status} />
        {b.status === "review" && b.previousSlot && (
          <small className="block reason-mini" title={b.previousSlot.reason}>
            {b.previousSlot.reason}
          </small>
        )}
        {!chk.ready && b.status === "pending" && (
          <small className="block cell-bad">{chk.reasons.join("、")}</small>
        )}
      </td>
      <td className="ops">
        {b.status === "pending" && (
          <>
            {b.rush ? (
              <button
                className="btn-rush"
                onClick={() => onMsg(store.rushInsert(b.id), "加急插单完成")}
              >
                加急插单
              </button>
            ) : (
              <button
                className="ghost"
                onClick={() => {
                  const s = earliestSlot(store.state, b, {
                    fromIso: store.now.toISOString(),
                  });
                  onMsg(
                    s
                      ? store.manualBook(b.id, s.machineId, toLocalInput(new Date(s.startAt)))
                      : "周期内无空档",
                    "已排入最早空档"
                  );
                }}
              >
                自动排
              </button>
            )}
            <button
              className="ghost"
              onClick={() => {
                store.updateBatch(b.id, { rush: !b.rush });
              }}
            >
              {b.rush ? "撤加急" : "设加急"}
            </button>
          </>
        )}
        {b.status === "review" && (
          <>
            <button
              className="ghost"
              disabled={!chk.ready}
              onClick={() => onMsg(store.resolveReview(b.id, "keep"), "已保留旧排期")}
            >
              保留
            </button>
            <button
              className="ghost"
              onClick={() => onMsg(store.resolveReview(b.id, "reschedule"), "已自动改约")}
            >
              改约
            </button>
            <button
              className="ghost danger-text"
              onClick={() => onMsg(store.resolveReview(b.id, "release"), "已释放")}
            >
              释放
            </button>
          </>
        )}
        {b.status === "scheduled" && (
          <button className="ghost" onClick={() => onMsg(store.startDye(b.id), "已开染")}>
            开染
          </button>
        )}
        {b.status === "running" && (
          <button className="ghost" onClick={() => onMsg(store.completeDye(b.id), "已完工")}>
            完工
          </button>
        )}
      </td>
    </tr>
  );
}

function RegisterModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const store = useStore();
  const [f, setF] = useState({
    orderNo: "",
    customer: "",
    fabric: "棉",
    colorTargetText: "1.0",
    colorTargetSet: true,
    recipeNo: "",
    recipeReviewed: false,
    durationMin: 300,
    holdMin: 40,
    finish: "",
    dueLocal: "",
    rush: false,
    note: "",
  });
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    if (!f.orderNo.trim() || !f.customer.trim() || !f.fabric.trim()) {
      setErr("订单号、客户、面料为必填");
      return;
    }
    if (f.durationMin <= 0) {
      setErr("预计染程需大于 0");
      return;
    }
    let dueAt: string | null = null;
    if (f.dueLocal) {
      dueAt = fromLocalInput(f.dueLocal).toISOString();
    }
    const input: BatchInput = {
      orderNo: f.orderNo.trim(),
      customer: f.customer.trim(),
      fabric: f.fabric.trim(),
      colorTarget: f.colorTargetSet ? Number(f.colorTargetText) : null,
      process: {
        recipeNo: f.recipeNo.trim(),
        recipeReviewed: f.recipeReviewed,
        durationMin: Number(f.durationMin),
        holdMin: Number(f.holdMin),
        finish: f.finish.trim(),
      },
      dueAt,
      rush: f.rush,
      note: f.note.trim(),
    };
    store.addBatch(input);
    onCreated();
  };

  return (
    <Modal title="登记打样批次" onClose={onClose} wide>
      <div className="form-grid-2">
        <Field label="订单号" required>
          <input className="ctl" value={f.orderNo} onChange={(e) => setF({ ...f, orderNo: e.target.value })} placeholder="如 SO-8830" />
        </Field>
        <Field label="客户" required>
          <input className="ctl" value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} />
        </Field>
        <Field label="面料" required>
          <input className="ctl" list="fabrics" value={f.fabric} onChange={(e) => setF({ ...f, fabric: e.target.value })} />
          <datalist id="fabrics">
            {FABRICS.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </Field>
        <Field label="交期">
          <input
            className="ctl"
            type="datetime-local"
            value={f.dueLocal}
            onChange={(e) => setF({ ...f, dueLocal: e.target.value })}
          />
        </Field>
        <Field label="色差目标 ΔE 上限" hint="未定则留待排">
          <div className="inline-ctl">
            <input
              className="ctl"
              type="number"
              step="0.1"
              min={0}
              disabled={!f.colorTargetSet}
              value={f.colorTargetText}
              onChange={(e) => setF({ ...f, colorTargetText: e.target.value })}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={f.colorTargetSet}
                onChange={(e) => setF({ ...f, colorTargetSet: e.target.checked })}
              />
              已确定
            </label>
          </div>
        </Field>
        <Field label="配方编号" hint="留空 = 无配方">
          <input className="ctl" value={f.recipeNo} onChange={(e) => setF({ ...f, recipeNo: e.target.value })} placeholder="如 R-C132" />
        </Field>
        <Field label="配方复核">
          <select
            className="ctl"
            value={f.recipeReviewed ? "1" : "0"}
            onChange={(e) => setF({ ...f, recipeReviewed: e.target.value === "1" })}
          >
            <option value="0">未复核（留待排）</option>
            <option value="1">已复核</option>
          </select>
        </Field>
        <Field label="预计染程（分钟）" required>
          <input className="ctl" type="number" step={15} min={0} value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) })} />
        </Field>
        <Field label="保温时间（分钟）">
          <input className="ctl" type="number" step={5} min={0} value={f.holdMin} onChange={(e) => setF({ ...f, holdMin: Number(e.target.value) })} />
        </Field>
        <Field label="后整理方式">
          <input className="ctl" value={f.finish} onChange={(e) => setF({ ...f, finish: e.target.value })} placeholder="如 柔软整理 2%" />
        </Field>
        <Field label="加急">
          <label className="check">
            <input type="checkbox" checked={f.rush} onChange={(e) => setF({ ...f, rush: e.target.checked })} />
            加急批次（插单时可后移其他已排批次）
          </label>
        </Field>
        <Field label="备注">
          <input className="ctl" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
      </div>
      {err && <div className="err-box">{err}</div>}
      <div className="dl-actions">
        <button className="primary" onClick={submit}>
          登记（进入待排）
        </button>
        <button onClick={onClose}>取消</button>
      </div>
    </Modal>
  );
}
