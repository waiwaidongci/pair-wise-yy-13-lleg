// 排程引擎：纯函数，不依赖 React / 存储
// 设计要点：
//  - running（开染中）块为固定障碍，任何操作都不能移动
//  - scheduled / review 块当前都占位；冲突检测把缓冲时间计入
//  - review（待确认）批次保留旧排期，不参与自动排程
//  - 加急插单可以推移 scheduled 批次、让出 review 批次，但不能跨越 running

import type {
  Batch,
  LogEntry,
  Rules,
  Slot,
  State,
} from "./types";

export interface EngineEvent {
  type: LogEntry["type"];
  batchId?: string;
  message: string;
}

export interface EngineResult {
  state: State;
  events: EngineEvent[];
}

export interface ReadyCheck {
  ready: boolean;
  reasons: string[];
}

export interface Block {
  batchId: string;
  machineId: string;
  start: number; // epoch ms
  end: number; // 含缓冲后的结束
  jobEnd: number; // 染程本身结束
  status: Batch["status"];
}

export interface Gap {
  machineId: string;
  start: string;
  end: string;
  fitMin: number;
}

export interface Risk {
  batchId: string;
  level: "danger" | "warn";
  message: string;
}

// ---------- 基础 ----------

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function durationMin(b: Batch): number {
  return Math.max(0, Math.round(b.process.durationMin || 0));
}

/** 上机前检查：色差目标未定 / 配方未复核 → 留待排 */
export function readiness(b: Batch): ReadyCheck {
  const reasons: string[] = [];
  if (b.colorTarget === null || Number.isNaN(b.colorTarget)) {
    reasons.push("色差目标未定");
  }
  if (!b.process.recipeNo.trim()) reasons.push("缺少配方编号");
  if (!b.process.recipeReviewed) reasons.push("配方未复核");
  if (durationMin(b) <= 0) reasons.push("预计染程为 0");
  return { ready: reasons.length === 0, reasons };
}

export function enabledMachines(state: State) {
  return state.machines.filter((m) => m.enabled);
}

/** 当前所有占位块（done 已出缸，不占位；缓冲加在块尾） */
export function blocks(state: State): Block[] {
  const buf = state.rules.bufferMin * 60000;
  const out: Block[] = [];
  for (const b of state.batches) {
    if (b.status === "scheduled" || b.status === "running") {
      if (b.slot) {
        const start = new Date(b.slot.startAt).getTime();
        const jobEnd = new Date(b.slot.endAt).getTime();
        out.push({
          batchId: b.id,
          machineId: b.slot.machineId,
          start,
          jobEnd,
          end: jobEnd + buf,
          status: b.status,
        });
      }
    } else if (b.status === "review" && b.previousSlot) {
      // 保留的旧排期继续占位，直到确认保留/释放/改约
      const start = new Date(b.previousSlot.startAt).getTime();
      const jobEnd = new Date(b.previousSlot.endAt).getTime();
      out.push({
        batchId: b.id,
        machineId: b.previousSlot.machineId,
        start,
        jobEnd,
        end: jobEnd + buf,
        status: "review",
      });
    }
  }
  return out;
}

export function findCollision(
  state: State,
  machineId: string,
  startIso: string,
  endIso: string,
  excludeId?: string
): Block | null {
  const start = new Date(startIso).getTime();
  const bufEnd = new Date(endIso).getTime() + state.rules.bufferMin * 60000;
  for (const blk of blocks(state)) {
    if (blk.batchId === excludeId) continue;
    if (blk.machineId !== machineId) continue;
    if (start < blk.end && bufEnd > blk.start) return blk;
  }
  return null;
}

// ---------- 工作时段窗口 ----------

/** 某一自然日的可排产窗口（epoch ms）；null 规则表示全天 */
function dayWindow(rules: Rules, day: Date): [number, number] {
  const base = new Date(day);
  base.setHours(0, 0, 0, 0);
  if (rules.workStartMin === null || rules.workEndMin === null) {
    return [base.getTime(), base.getTime() + 24 * 3600000];
  }
  return [
    base.getTime() + rules.workStartMin * 60000,
    base.getTime() + rules.workEndMin * 60000,
  ];
}

/**
 * 从 from 起，找当天/后续窗口内首个 >= from 的可入时刻。
 * 返回候选时刻（ms）或 null（超出 horizon）。
 */
function nextWindowEntry(rules: Rules, from: number, horizon: number): number | null {
  const step = rules.slotStepMin * 60000;
  let t = from;
  for (let i = 0; i <= rules.horizonDays + 1; i++) {
    const day = new Date(t);
    const [ws, we] = dayWindow(rules, day);
    if (t < ws) t = ws;
    if (t < we) return Math.ceil(t / step) * step;
    t = new Date(we).setHours(0, 0, 0, 0) + 24 * 3600000;
  }
  return null;
}

/** 区间 [t, t+needMs]（含缓冲）是否整体落在某工作窗口内 */
function fitsWorkWindow(rules: Rules, t: number, needMs: number): boolean {
  if (rules.workStartMin === null || rules.workEndMin === null) return true;
  const d = new Date(t);
  const [ws, we] = dayWindow(rules, d);
  return t >= ws && t + needMs <= we;
}

// ---------- 空档搜索 ----------

export interface EarliestOptions {
  fromIso?: string;
  ignoreIds?: string[];
  machineIds?: string[];
}

/** 找满足工作时段、缓冲、无冲突的最早开始时刻 */
export function earliestSlot(
  state: State,
  batch: Batch,
  opts: EarliestOptions = {}
): Slot | null {
  const rules = state.rules;
  const dur = durationMin(batch);
  const need = (dur + rules.bufferMin) * 60000;
  const nowMs = opts.fromIso ? new Date(opts.fromIso).getTime() : Date.now();
  const horizon = nowMs + rules.horizonDays * 86400000;
  const step = rules.slotStepMin * 60000;
  const machines = (
    opts.machineIds
      ? state.machines.filter((m) => opts.machineIds!.includes(m.id))
      : enabledMachines(state)
  );

  let best: Slot | null = null;
  for (const m of machines) {
    const ignore = new Set(opts.ignoreIds ?? []);
    const blks = blocks(state)
      .filter((b) => b.machineId === m.id && !ignore.has(b.batchId))
      .sort((a, b) => a.start - b.start);

    let t: number = nextWindowEntry(rules, nowMs, horizon) ?? Infinity;
    if (!isFinite(t)) continue;

    while (t + dur * 60000 <= horizon) {
      if (!fitsWorkWindow(rules, t, need)) {
        // 推进到下一工作日窗口
        const day0 = new Date(t);
        day0.setHours(0, 0, 0, 0);
        const nextDay = day0.getTime() + 86400000;
        const entry = nextWindowEntry(rules, nextDay, horizon);
        if (entry === null) break;
        t = entry;
        continue;
      }
      const cur = t;
      const hit = blks.find((b) => cur < b.end && cur + need > b.start);
      if (!hit) {
        const slot: Slot = {
          machineId: m.id,
          startAt: new Date(cur).toISOString(),
          endAt: new Date(cur + dur * 60000).toISOString(),
        };
        if (!best || cur < new Date(best.startAt).getTime()) best = slot;
        break;
      }
      // 越过冲突块（块尾已含缓冲），对齐刻度
      t = Math.max(cur + step, Math.ceil(hit.end / step) * step);
    }
  }
  return best;
}

// ---------- 手动占位 ----------

export function manualBook(
  prev: State,
  batchId: string,
  machineId: string,
  startIso: string,
  nowIso: string
): EngineResult {
  const state = clone(prev);
  const b = state.batches.find((x) => x.id === batchId);
  const events: EngineEvent[] = [];
  if (!b) throw new Error("批次不存在");
  if (b.status === "running" || b.status === "done")
    throw new Error("已开染/已完成的安排不能改动");

  const chk = readiness(b);
  if (!chk.ready)
    throw new Error(`暂不可排：${chk.reasons.join("、")}`);
  const machine = state.machines.find((m) => m.id === machineId);
  if (!machine || !machine.enabled) throw new Error("染缸不可用");

  const start = new Date(startIso);
  const step = state.rules.slotStepMin * 60000;
  if (start.getTime() % step !== 0)
    throw new Error(`开始时刻需对齐 ${state.rules.slotStepMin} 分钟刻度`);
  if (start.getTime() < new Date(nowIso).getTime() - 60000)
    throw new Error("不能把开始时刻排在过去");

  const dur = durationMin(b) * 60000;
  const end = start.getTime() + dur;
  if (end > new Date(nowIso).getTime() + state.rules.horizonDays * 86400000)
    throw new Error("超出可排产周期");
  if (!fitsWorkWindow(state.rules, start.getTime(), dur + state.rules.bufferMin * 60000))
    throw new Error("与每日可排产时段冲突");

  const hit = findCollision(state, machineId, startIso, new Date(end).toISOString(), b.id);
  if (hit) {
    const other = state.batches.find((x) => x.id === hit.batchId);
    throw new Error(
      `与 ${other?.id ?? hit.batchId}（${statusLabel(hit.status)}）时间重叠`
    );
  }

  const slot: Slot = {
    machineId,
    startAt: start.toISOString(),
    endAt: new Date(end).toISOString(),
  };
  if (b.status === "review") {
    events.push({
      type: "review-resolve",
      batchId: b.id,
      message: `${b.id} 待确认批次按新排期改约（${machine.name} ${new Date(
        startIso
      ).toLocaleString("zh-CN")}），旧排期作废`,
    });
    b.previousSlot = null;
  }
  b.status = "scheduled";
  b.slot = slot;
  events.push({
    type: "book",
    batchId: b.id,
    message: `${b.id}（订单 ${b.orderNo}）手动占位：${machine.name}，${new Date(
      startIso
    ).toLocaleString("zh-CN")} 开染`,
  });
  return { state, events };
}

// ---------- 自动排程（待排批次） ----------

export function autoSchedule(prev: State, nowIso: string): EngineResult {
  const state = clone(prev);
  const events: EngineEvent[] = [];
  const queue = state.batches
    .filter((b) => b.status === "pending")
    .sort((a, b2) => {
      if (a.rush !== b2.rush) return a.rush ? -1 : 1;
      const da = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
      const db = b2.dueAt ? new Date(b2.dueAt).getTime() : Infinity;
      if (da !== db) return da - db;
      return a.createdAt.localeCompare(b2.createdAt);
    });

  let placed = 0;
  for (const b of queue) {
    const chk = readiness(b);
    if (!chk.ready) continue;
    const slot = earliestSlot(state, b, { fromIso: nowIso });
    if (!slot) {
      events.push({
        type: "schedule-skip",
        batchId: b.id,
        message: `${b.id} 周期内无可用空档，继续待排${
          b.rush ? "（加急）" : ""
        }`,
      });
      continue;
    }
    b.status = "scheduled";
    b.slot = slot;
    placed += 1;
    const m = state.machines.find((x) => x.id === slot.machineId);
    events.push({
      type: "auto-schedule",
      batchId: b.id,
      message: `${b.id} 自动排入 ${m?.name}，${new Date(
        slot.startAt
      ).toLocaleString("zh-CN")} 开染${b.rush ? "（加急）" : ""}`,
    });
  }
  events.push({
    type: "auto-schedule-summary",
    message: `自动排程完成：排入 ${placed} 个批次，${queue.length - placed} 个留待排`,
  });
  return { state, events };
}

// ---------- 加急插单 ----------

interface RushPlan {
  targetId: string;
  machineId: string;
  start: number;
  targetSlot: Slot;
  moves: { batchId: string; slot: Slot }[];
  drops: { batchId: string; reason: string }[];
  displaced: number;
}

/**
 * 加急插单：running 为固定障碍；scheduled 可向后平移，review 让位回待排。
 * 选择目标开始最早的方案；开始相同则移动批次最少。
 */
export function rushInsert(
  prev: State,
  batchId: string,
  nowIso: string
): EngineResult {
  const state = clone(prev);
  const events: EngineEvent[] = [];
  const target = state.batches.find((x) => x.id === batchId);
  if (!target) throw new Error("批次不存在");
  if (target.status === "running" || target.status === "done")
    throw new Error("该批次已开染");
  const chk = readiness(target);
  if (!chk.ready) throw new Error(`暂不可排：${chk.reasons.join("、")}`);

  const rules = state.rules;
  const dur = durationMin(target);
  const need = (dur + rules.bufferMin) * 60000;
  const nowMs = new Date(nowIso).getTime();
  const horizon = nowMs + rules.horizonDays * 86400000;
  const step = rules.slotStepMin * 60000;

  const allBlocks = blocks(state).filter((b) => b.batchId !== target.id);
  let best: RushPlan | null = null;

  for (const m of enabledMachines(state)) {
    const fixed = allBlocks
      .filter((b) => b.machineId === m.id && b.status === "running")
      .sort((a, b) => a.start - b.start);
    const movable = allBlocks
      .filter(
        (b) =>
          b.machineId === m.id &&
          (b.status === "scheduled" || b.status === "review")
      )
      .sort((a, b) => a.start - b.start);

    // 枚举工作窗口被固定块切出的空闲段
    const segments: [number, number][] = [];
    for (let i = 0; i <= rules.horizonDays; i++) {
      const day = new Date(nowMs + i * 86400000);
      const [ws0, we] = dayWindow(rules, day);
      const ws = Math.max(ws0, Math.ceil(nowMs / step) * step);
      let segStart = ws;
      for (const f of fixed) {
        const fStart = f.start - rules.bufferMin * 60000;
        if (fStart >= segStart && fStart < we) {
          if (fStart - segStart >= need) segments.push([segStart, fStart]);
        }
        segStart = Math.max(segStart, f.end);
      }
      if (we - segStart >= need) segments.push([segStart, we]);
    }

    for (const [segStart, segEnd] of segments) {
      if (segStart + need > segEnd || segStart + dur * 60000 > horizon) continue;
      const plan = evaluateRushSegment(
        state,
        target,
        m.id,
        segStart,
        need,
        movable,
        nowMs
      );
      if (
        plan &&
        (!best ||
          plan.start < best.start ||
          (plan.start === best.start && plan.displaced < best.displaced) ||
          (plan.start === best.start &&
            plan.displaced === best.displaced &&
            plan.machineId < best.machineId))
      ) {
        best = plan;
      }
    }
  }

  if (!best) throw new Error("加急插单失败：周期内没有可插入的空档");
  applyRushPlan(state, best, events);
  return { state, events };
}

function evaluateRushSegment(
  state: State,
  target: Batch,
  machineId: string,
  segStart: number,
  need: number,
  movable: Block[],
  nowMs: number
): RushPlan | null {
  const rules = state.rules;
  const tEnd = segStart + need;
  const overlaps = movable.filter((b) => segStart < b.end && tEnd > b.start);
  const moves: RushPlan["moves"] = [];
  const drops: RushPlan["drops"] = [];

  // 模拟占位：目标块 + 未被移动的其他块
  const sim = clone(state);
  for (const b of sim.batches) {
    if (b.id === target.id) {
      b.status = "scheduled";
      b.slot = {
        machineId,
        startAt: new Date(segStart).toISOString(),
        endAt: new Date(segStart + durationMin(target) * 60000).toISOString(),
      };
      b.previousSlot = null;
    } else if (overlaps.some((o) => o.batchId === b.id)) {
      // 先腾空，稍后尝试重新安置
      b.slot = null;
      b.status = "pending";
    }
  }

  for (const o of overlaps) {
    const ob = state.batches.find((x) => x.id === o.batchId)!;
    if (o.status === "review") {
      // 待确认批次让位：回待排，保留变更原因
      drops.push({
        batchId: o.batchId,
        reason: `加急批次 ${target.id} 插单，${state.machines.find((m) => m.id === machineId)?.name} 旧排期被占用`,
      });
      continue;
    }
    // scheduled：尽力平移到不早于原开始时刻的最早空档（可换缸）
    const slot = earliestSlot(sim, ob, {
      fromIso: new Date(o.start).toISOString(),
    });
    if (!slot) {
      drops.push({
        batchId: o.batchId,
        reason: `加急批次 ${target.id} 插单，平移后周期内无空档`,
      });
      continue;
    }
    const sb = sim.batches.find((x) => x.id === o.batchId)!;
    sb.status = "scheduled";
    sb.slot = slot;
    moves.push({ batchId: o.batchId, slot });
  }

  return {
    targetId: target.id,
    machineId,
    start: segStart,
    targetSlot: sim.batches.find((x) => x.id === target.id)!.slot!,
    moves,
    drops,
    displaced: overlaps.length,
  };
}

function applyRushPlan(
  state: State,
  plan: RushPlan,
  events: EngineEvent[]
) {
  const target = state.batches.find((b) => b.id === plan.targetId)!;
  target.status = "scheduled";
  target.slot = plan.targetSlot;
  target.previousSlot = null;
  const tm = state.machines.find((m) => m.id === plan.targetSlot.machineId);
  events.push({
    type: "rush",
    batchId: target.id,
    message: `加急插单：${target.id}（订单 ${target.orderNo}）排入 ${tm?.name}，${new Date(
      plan.targetSlot.startAt
    ).toLocaleString("zh-CN")} 开染`,
  });

  for (const mv of plan.moves) {
    const b = state.batches.find((x) => x.id === mv.batchId)!;
    const oldSlot = b.slot;
    b.status = "scheduled";
    b.slot = mv.slot;
    const m = state.machines.find((x) => x.id === mv.slot.machineId);
    events.push({
      type: "rush-shift",
      batchId: b.id,
      message: `${b.id} 因 ${target.id} 加急插单后移：${
        oldSlot ? new Date(oldSlot.startAt).toLocaleString("zh-CN") : "原排期"
      } → ${m?.name} ${new Date(mv.slot.startAt).toLocaleString("zh-CN")}`,
    });
  }

  for (const dp of plan.drops) {
    const b = state.batches.find((x) => x.id === dp.batchId)!;
    const wasReview = b.status === "review";
    const kept = wasReview && b.previousSlot
      ? `（旧排期 ${state.machines.find((m) => m.id === b.previousSlot!.machineId)
          ?.name} ${new Date(b.previousSlot.startAt).toLocaleString("zh-CN")}；${
          b.previousSlot.reason
        }）`
      : "";
    b.status = "pending";
    b.slot = null;
    b.previousSlot = null;
    events.push({
      type: "rush-shift",
      batchId: b.id,
      message: `${b.id} 因 ${target.id} 加急插单让出排期，退回待排${kept}`,
    });
  }
}

// ---------- 状态流转 ----------

export function startDye(prev: State, batchId: string): EngineResult {
  const state = clone(prev);
  const b = state.batches.find((x) => x.id === batchId);
  if (!b) throw new Error("批次不存在");
  if (b.status !== "scheduled") throw new Error("只有已排批次可以开染");
  b.status = "running";
  return {
    state,
    events: [
      { type: "start", batchId: b.id, message: `${b.id} 已开染，排期锁定` },
    ],
  };
}

export function completeDye(prev: State, batchId: string): EngineResult {
  const state = clone(prev);
  const b = state.batches.find((x) => x.id === batchId);
  if (!b) throw new Error("批次不存在");
  if (b.status !== "running") throw new Error("只有开染中批次可以完工");
  b.status = "done";
  return {
    state,
    events: [{ type: "complete", batchId: b.id, message: `${b.id} 染整完工` }],
  };
}

export type ConfirmAction = "keep" | "release" | "reschedule";

export function resolveReview(
  prev: State,
  batchId: string,
  action: ConfirmAction,
  nowIso: string,
  manual?: { machineId: string; startIso: string }
): EngineResult {
  const state = clone(prev);
  const events: EngineEvent[] = [];
  const b = state.batches.find((x) => x.id === batchId);
  if (!b) throw new Error("批次不存在");
  if (b.status !== "review") throw new Error("该批次不在待确认");

  if (action === "release") {
    const reason = b.previousSlot?.reason ?? "";
    b.previousSlot = null;
    b.slot = null;
    b.status = "pending";
    events.push({
      type: "review-resolve",
      batchId: b.id,
      message: `${b.id} 释放旧排期，退回待排（原因：${reason}）`,
    });
    return { state, events };
  }

  if (action === "keep") {
    if (!b.previousSlot) throw new Error("没有可保留的旧排期");
    const chk = readiness(b);
    if (!chk.ready)
      throw new Error(`资料仍不齐（${chk.reasons.join("、")}），请先补齐或释放`);
    const hit = findCollision(
      state,
      b.previousSlot.machineId,
      b.previousSlot.startAt,
      b.previousSlot.endAt,
      b.id
    );
    if (hit) {
      const other = state.batches.find((x) => x.id === hit.batchId);
      throw new Error(
        `旧排期现已与 ${other?.id ?? hit.batchId} 重叠，请释放或改约`
      );
    }
    b.slot = { ...b.previousSlot };
    b.previousSlot = null;
    b.status = "scheduled";
    events.push({
      type: "review-resolve",
      batchId: b.id,
      message: `${b.id} 复核通过，保留原排期`,
    });
    return { state, events };
  }

  // reschedule
  const chk = readiness(b);
  if (!chk.ready) throw new Error(`资料仍不齐（${chk.reasons.join("、")}）`);
  let slot: Slot | null;
  if (manual) {
    const sub = clone(state);
    const tb = sub.batches.find((x) => x.id === b.id)!;
    tb.status = "pending";
    tb.previousSlot = null;
    const r = manualBook(sub, b.id, manual.machineId, manual.startIso, nowIso);
    return {
      state: r.state,
      events: [
        {
          type: "review-resolve",
          batchId: b.id,
          message: `${b.id} 改约到新时段，旧排期作废`,
        },
        ...r.events.filter((e) => e.type === "book"),
      ],
    };
  }
  slot = earliestSlot(state, b, { fromIso: nowIso });
  if (!slot) throw new Error("周期内无可用空档，无法改约");
  b.previousSlot = null;
  b.slot = slot;
  b.status = "scheduled";
  const m = state.machines.find((x) => x.id === slot!.machineId);
  events.push({
    type: "review-resolve",
    batchId: b.id,
    message: `${b.id} 自动改约到 ${m?.name}，${new Date(
      slot.startAt
    ).toLocaleString("zh-CN")} 开染`,
  });
  return { state, events };
}

// ---------- 工艺 / 规则变更 ----------

export interface ProcessPatch {
  recipeNo?: string;
  recipeReviewed?: boolean;
  durationMin?: number;
  holdMin?: number;
  finish?: string;
}

/**
 * 配方 / 保温时间 / 后整理（含染程时长）变更。
 *  - 仅档案（待排/已完成）：直接改
 *  - 已排 / 待确认：退回待确认，旧排期保留为快照并记录原因
 *  - 开染中：禁止（已开染的安排不能被打乱）
 */
export function changeProcess(
  prev: State,
  batchId: string,
  patch: ProcessPatch
): EngineResult {
  const state = clone(prev);
  const events: EngineEvent[] = [];
  const b = state.batches.find((x) => x.id === batchId);
  if (!b) throw new Error("批次不存在");
  if (b.status === "running")
    throw new Error("批次已开染，工艺变更不可回改排期");

  const changes: string[] = [];
  if (
    patch.recipeNo !== undefined &&
    patch.recipeNo !== b.process.recipeNo
  ) {
    changes.push(`配方 ${b.process.recipeNo || "（空）"} → ${patch.recipeNo || "（空）"}`);
  }
  if (
    patch.recipeReviewed !== undefined &&
    patch.recipeReviewed !== b.process.recipeReviewed
  ) {
    changes.push(`配方复核状态 → ${patch.recipeReviewed ? "已复核" : "未复核"}`);
  }
  if (
    patch.durationMin !== undefined &&
    patch.durationMin !== b.process.durationMin
  ) {
    changes.push(`预计染程 ${b.process.durationMin} → ${patch.durationMin} 分`);
  }
  if (patch.holdMin !== undefined && patch.holdMin !== b.process.holdMin) {
    changes.push(`保温时间 ${b.process.holdMin} → ${patch.holdMin} 分`);
  }
  if (patch.finish !== undefined && patch.finish !== b.process.finish) {
    changes.push(`后整理「${b.process.finish || "无"}」→「${patch.finish || "无"}」`);
  }
  if (changes.length === 0) return { state, events };

  Object.assign(b.process, patch);

  const scheduled = b.status === "scheduled";
  if (scheduled && b.slot) {
    b.previousSlot = { ...b.slot, reason: `工艺变更：${changes.join("；")}` };
    b.slot = null;
    b.status = "review";
  } else if (b.status === "review" && b.previousSlot) {
    // 待确认批次再次变更：旧排期快照保留，原因累加
    b.previousSlot.reason = `${b.previousSlot.reason}；再次变更：${changes.join(
      "；"
    )}`;
  } else if (b.status === "review") {
    /* 无快照可保留 */
  }

  events.push({
    type: "process-change",
    batchId: b.id,
    message: `${b.id}${
      scheduled ? " 工艺变更，退回待确认并保留旧排期：" : " 工艺资料更新："
    }${changes.join("；")}`,
  });
  return { state, events };
}

/** 排程规则变更后，已排批次若与新规则冲突则退回待确认（开染中不动） */
export function updateRules(
  prev: State,
  next: Rules,
  nowIso: string
): EngineResult {
  const state = clone(prev);
  const events: EngineEvent[] = [];
  const old = state.rules;
  state.rules = clone(next);

  const changes: string[] = [];
  if (old.bufferMin !== next.bufferMin)
    changes.push(`缸间缓冲 ${old.bufferMin} → ${next.bufferMin} 分`);
  if (old.horizonDays !== next.horizonDays)
    changes.push(`排产周期 ${old.horizonDays} → ${next.horizonDays} 天`);
  if (old.slotStepMin !== next.slotStepMin)
    changes.push(`排程刻度 ${old.slotStepMin} → ${next.slotStepMin} 分`);
  if (
    old.workStartMin !== next.workStartMin ||
    old.workEndMin !== next.workEndMin
  ) {
    const winLabel = (s: number | null, e: number | null) =>
      s === null || e === null
        ? "全天"
        : `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(
            s % 60
          ).padStart(2, "0")}–${String(Math.floor(e / 60)).padStart(
            2,
            "0"
          )}:${String(e % 60).padStart(2, "0")}`;
    changes.push(
      `工作时段 ${winLabel(old.workStartMin, old.workEndMin)} → ${winLabel(
        next.workStartMin,
        next.workEndMin
      )}`
    );
  }
  if (old.warnBeforeDueHours !== next.warnBeforeDueHours)
    changes.push(
      `交期预警 ${old.warnBeforeDueHours} → ${next.warnBeforeDueHours} 小时`
    );

  events.push({
    type: "rules-change",
    message: `排程规则更新：${changes.join("；") || "无实质变化"}`,
  });

  if (changes.length === 0) return { state, events };

  // 用新规则复核已排批次（running 锁定不动）
  for (const b of state.batches) {
    if (b.status !== "scheduled" || !b.slot) continue;
    const reasons: string[] = [];
    const start = new Date(b.slot.startAt);
    const need =
      durationMin(b) * 60000 + next.bufferMin * 60000;
    if (!fitsWorkWindow(next, start.getTime(), need))
      reasons.push("超出每日工作时段");
    const hit = findCollision(state, b.slot.machineId, b.slot.startAt, b.slot.endAt, b.id);
    if (hit) {
      const other = state.batches.find((x) => x.id === hit.batchId);
      reasons.push(`与 ${other?.id ?? hit.batchId} 的缓冲/时段冲突`);
    }
    if (
      new Date(b.slot.endAt).getTime() + next.bufferMin * 60000 >
      new Date(nowIso).getTime() + next.horizonDays * 86400000
    ) {
      reasons.push("超出排产周期");
    }
    if (reasons.length) {
      b.previousSlot = {
        ...b.slot,
        reason: `规则变更后复核不通过：${reasons.join("、")}`,
      };
      b.slot = null;
      b.status = "review";
      events.push({
        type: "review-return",
        batchId: b.id,
        message: `${b.id} 因规则变更退回待确认（${reasons.join("、")}），旧排期已保留`,
      });
    }
  }
  return { state, events };
}

// ---------- 空档 / 风险 ----------

/** 指定一天内各染缸的空档 */
export function gapsOfDay(state: State, dayIso: string): Gap[] {
  const rules = state.rules;
  const day = new Date(dayIso);
  const out: Gap[] = [];
  for (const m of enabledMachines(state)) {
    const [ws, we] = dayWindow(rules, day);
    const cuts: [number, number][] = blocks(state)
      .filter((b) => b.machineId === m.id)
      .map((b): [number, number] => [
        Math.max(b.start, ws),
        Math.min(b.end, we),
      ])
      .filter(([s, e]) => e > s)
      .sort((a, b) => a[0] - b[0]);
    let t = ws;
    for (const [s, e] of cuts) {
      if (s > t && s - t >= rules.slotStepMin * 60000) {
        out.push({
          machineId: m.id,
          start: new Date(t).toISOString(),
          end: new Date(s).toISOString(),
          fitMin: Math.round((s - t) / 60000),
        });
      }
      t = Math.max(t, e);
    }
    if (we > t && we - t >= rules.slotStepMin * 60000) {
      out.push({
        machineId: m.id,
        start: new Date(t).toISOString(),
        end: new Date(we).toISOString(),
        fitMin: Math.round((we - t) / 60000),
      });
    }
  }
  return out;
}

export function risks(prev: State, nowIso: string): Risk[] {
  const state = prev;
  const warnMs = state.rules.warnBeforeDueHours * 3600000;
  const out: Risk[] = [];
  for (const b of state.batches) {
    if (b.status === "done" || !b.dueAt) continue;
    const due = new Date(b.dueAt).getTime();

    if (
      (b.status === "scheduled" || b.status === "running") &&
      b.slot
    ) {
      const end = new Date(b.slot.endAt).getTime();
      if (end > due) {
        out.push({
          batchId: b.id,
          level: "danger",
          message: `预计完工晚于交期 ${Math.round((end - due) / 3600000)} 小时`,
        });
      } else if (due - end <= warnMs) {
        out.push({
          batchId: b.id,
          level: "warn",
          message: `距交期仅剩 ${Math.round((due - end) / 3600000)} 小时缓冲`,
        });
      }
    } else if (b.status === "review" && b.previousSlot) {
      const end = new Date(b.previousSlot.endAt).getTime();
      if (end > due) {
        out.push({
          batchId: b.id,
          level: "danger",
          message: `旧排期完工已晚于交期，且变更待确认`,
        });
      } else {
        out.push({
          batchId: b.id,
          level: "warn",
          message: `变更待确认，旧排期距交期缓冲 ${Math.round(
            (due - end) / 3600000
          )} 小时`,
        });
      }
    } else if (b.status === "pending") {
      const slot = earliestSlot(state, b, { fromIso: nowIso });
      if (!slot) {
        out.push({
          batchId: b.id,
          level: "danger",
          message: `周期内无空档，交期 ${new Date(due).toLocaleDateString(
            "zh-CN"
          )} 存在脱期风险`,
        });
      } else {
        const end = new Date(slot.endAt).getTime();
        if (end > due) {
          out.push({
            batchId: b.id,
            level: "danger",
            message: `最早可排完工仍晚于交期 ${Math.round(
              (end - due) / 3600000
            )} 小时`,
          });
        } else if (due - end <= warnMs) {
          out.push({
            batchId: b.id,
            level: "warn",
            message: `即使最早排程，距交期也仅剩 ${Math.round(
              (due - end) / 3600000
            )} 小时`,
          });
        }
      }
    }
  }
  return out.sort((a, b) => (a.level === "danger" ? -1 : 1));
}

export function statusLabel(s: Batch["status"]): string {
  return (
    {
      pending: "待排",
      scheduled: "已排",
      review: "待确认",
      running: "开染中",
      done: "已完成",
    } as const
  )[s];
}
