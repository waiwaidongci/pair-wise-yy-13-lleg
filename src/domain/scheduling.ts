// 排程规则引擎：全部为纯函数，不碰存储与界面，可独立单测。
// 规则要点：
// 1) 机器时间区间（含染缸）重叠即冲突；开染区间为锚点，任何安排不能打乱。
// 2) 色差目标未定 / 配方未复核 / 与现有安排重叠 → 留待排并给出原因。
// 3) 加急优先选空档；启用加急提前时可把普通「已排」批次挤回待排。
// 4) 配方、保温时间、后整理、染程时长变更 → 退回待确认，旧排期与原因保留。
import type {
  Batch,
  Blocker,
  ChangeCode,
  RuleSettings,
  Slot,
  Vat,
} from './types';

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

export const DEFAULT_RULES: RuleSettings = {
  slotStepMinutes: 30,
  horizonDays: 7,
  riskSoonHours: 24,
  riskBufferHours: 8,
  rushPreempt: true,
};

// ---------- 基础工具 ----------

export function slotEnd(start: number, durationMinutes: number): number {
  return start + durationMinutes * 60_000;
}

/** 吸附到时间粒度（向下取整） */
export function snapToStep(t: number, stepMinutes: number): number {
  const step = stepMinutes * 60_000;
  return Math.floor(t / step) * step;
}

export function overlap(a: Slot, b: Slot): boolean {
  return a.vatId === b.vatId && a.start < b.end && b.start < a.end;
}

/** 开染中批次占用的锚点区间——不可被任何操作打乱 */
export function anchorSlots(batches: Batch[]): Slot[] {
  return batches
    .filter((b) => (b.status === '开染' || b.status === '完成') && b.slot)
    .map((b) => b.slot as Slot);
}

/** 参与占位冲突判断的全部区间：开染/完成锚点 + 已排 + 待确认保留的旧排期 */
export function occupiedSlots(batches: Batch[]): Slot[] {
  const slots: Slot[] = [];
  for (const b of batches) {
    if (b.slot) slots.push(b.slot);
    if (b.held) slots.push(b.held.slot);
  }
  return slots;
}

export function conflictsOn(slot: Slot, others: Slot[]): Slot[] {
  return others.filter((s) => overlap(slot, s));
}

// ---------- 开排校验 ----------

/**
 * 待排批次的挡单原因：
 * - 色差要求未定：colorTarget 为空
 * - 配方没复核：recipe.reviewed=false
 * - 机器重叠：与传入的占用区间重叠（登记时携带期望染缸/时刻才检查）
 */
export function blockersFor(
  batch: Pick<Batch, 'colorTarget' | 'recipe' | 'preferredVatId' | 'preferredStart' | 'durationMinutes' | 'id'>,
  occupied: Slot[],
  vats: Vat[],
): Blocker[] {
  const blockers: Blocker[] = [];
  if (!batch.colorTarget || !batch.colorTarget.trim()) {
    blockers.push({ kind: '颜色未定', detail: '色差目标（ΔE）尚未填写' });
  }
  if (!batch.recipe.reviewed) {
    blockers.push({
      kind: '配方未复核',
      detail: `配方 ${batch.recipe.code || '?'} 未经工艺员复核`,
    });
  }
  if (batch.preferredVatId && batch.preferredStart) {
    const vat = vats.find((v) => v.id === batch.preferredVatId);
    const trial: Slot = {
      vatId: batch.preferredVatId,
      start: batch.preferredStart,
      end: slotEnd(batch.preferredStart, batch.durationMinutes),
    };
    const hit = conflictsOn(trial, occupied);
    if (hit.length > 0) {
      blockers.push({
        kind: '机器重叠',
        detail: `期望染缸 ${vat?.name ?? trial.vatId} 该时段已有安排（${hit.length} 段）`,
      });
    }
  }
  return blockers;
}

/** 是否具备进入排程的条件（颜色已定 + 配方已复核） */
export function isReady(b: Pick<Batch, 'colorTarget' | 'recipe'>): boolean {
  return Boolean(b.colorTarget && b.colorTarget.trim() && b.recipe.reviewed);
}

// ---------- 空档 ----------

export interface Gap {
  vatId: Vat['id'];
  start: number;
  end: number;
  minutes: number;
}

/**
 * 指定染缸在 [from, to] 内的空档（仅避开锚点区间；
 * 已排批次可被加急重排，因此查“硬空档”时默认只认开染/完成）。
 */
export function vatGaps(
  vatId: string,
  from: number,
  to: number,
  batches: Batch[],
  hardOnly = true,
): Gap[] {
  const busy = (hardOnly ? anchorSlots(batches) : occupiedSlots(batches))
    .filter((s) => s.vatId === vatId)
    .filter((s) => s.start < to && s.end > from)
    .map((s) => ({ start: Math.max(s.start, from), end: Math.min(s.end, to) }))
    .sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const seg of busy) {
    const last = merged[merged.length - 1];
    if (last && seg.start <= last.end) last.end = Math.max(last.end, seg.end);
    else merged.push({ ...seg });
  }

  const gaps: Gap[] = [];
  let cursor = from;
  for (const seg of merged) {
    if (seg.start > cursor) {
      gaps.push({
        vatId,
        start: cursor,
        end: seg.start,
        minutes: Math.round((seg.start - cursor) / 60_000),
      });
    }
    cursor = Math.max(cursor, seg.end);
  }
  if (cursor < to) {
    gaps.push({ vatId, start: cursor, end: to, minutes: Math.round((to - cursor) / 60_000) });
  }
  return gaps;
}

/**
 * 能容纳指定染程时长的最早空档（跨所有启用染缸）。
 * hardOnly=true 时只避让开染/完成锚点（用于“加急若挤退已排批次后能否落入”的推演）；
 * 默认 false，普通已排、待确认冻结槽都视为占用，避免产生重叠排期。
 */
export function earliestGap(
  durationMinutes: number,
  from: number,
  to: number,
  vats: Vat[],
  batches: Batch[],
  preferredVatId?: string,
  stepMinutes = 30,
  hardOnly = false,
): { slot: Slot } | null {
  const ordered = [...vats].sort((a, b) => {
    if (a.id === preferredVatId) return -1;
    if (b.id === preferredVatId) return 1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
  let best: { slot: Slot } | null = null;
  for (const vat of ordered) {
    if (!vat.active) continue;
    const g = vatGaps(vat.id, from, to, batches, hardOnly).find(
      (x) => x.minutes >= durationMinutes,
    );
    if (g && (!best || g.start < best.slot.start)) {
      const start = Math.max(g.start, snapToStep(from, stepMinutes));
      best = {
        slot: {
          vatId: vat.id,
          start,
          end: slotEnd(start, durationMinutes),
        },
      };
    }
  }
  return best;
}

// ---------- 自动排程 ----------

export interface Placement {
  batchId: string;
  slot: Slot;
  /** 被加急挤回待排的批次 */
  displaced: string[];
}

export interface ScheduleResult {
  placed: Placement[];
  /** 未能排上的批次及原因 */
  remaining: { batchId: string; reason: string }[];
}

/**
 * 自动排程：在不动任何开染/完成锚点的前提下，把“就绪”的待排批次
 * 按加急优先、交期先后、登记先后放入最早空档。
 * 若开启加急提前且首选空档被普通已排批次占用，允许将其挤回待排后重排。
 */
export function autoSchedule(
  batchesInput: Batch[],
  vats: Vat[],
  rules: RuleSettings,
  now: number,
): { batches: Batch[]; result: ScheduleResult } {
  let batches = batchesInput.map((b) => ({ ...b }));
  const result: ScheduleResult = { placed: [], remaining: [] };

  // 就绪 = 档案条件齐备（颜色已定、配方已复核）。
  // “机器重叠”类阻碍随其他批次变动可能消失，因此不作为永久排除条件，每轮动态重算。
  const ready = batches
    .filter((b) => b.status === '待排' && isReady(b))
    .sort((a, b) => {
      if (a.rush !== b.rush) return a.rush ? -1 : 1;
      if (a.dueAt !== b.dueAt) return a.dueAt - b.dueAt;
      return a.createdAt - b.createdAt;
    });

  const horizonEnd = now + rules.horizonDays * DAY_MS;

  for (const target of ready) {
    const find = (list: Batch[]) =>
      earliestGap(
        target.durationMinutes,
        now,
        horizonEnd,
        vats,
        list,
        target.preferredVatId,
        rules.slotStepMinutes,
      );

    let found = find(batches);

    // 加急提前：普通「已排」批次可以让位（开染/完成锚点绝不动，加急单也不挤加急单）
    const displaced: string[] = [];
    if (!found && target.rush && rules.rushPreempt) {
      // 依次尝试：只挤首选缸 → 任意缸，且只移走“落在所选槽位上”的批次，避免无谓扰动
      const preferences: (string | undefined)[] = Array.from(
        new Set([target.preferredVatId, undefined]),
      );
      for (const pref of preferences) {
        // 只考虑该缸（或任意缸）上真正可让位的普通已排批次
        const candidates = batches.filter(
          (b) =>
            b.status === '已排' &&
            !b.rush &&
            b.slot &&
            (pref === undefined || b.slot.vatId === pref),
        );
        if (!candidates.length) continue;
        // 仅假设这些候选批次让位（锚点、加急已排、待确认冻结槽全部保留）
        const cleared = batches.map((b) =>
          candidates.some((c) => c.id === b.id)
            ? { ...b, slot: undefined, status: '待排' as const, blockers: [] }
            : b,
        );
        const retry = earliestGap(
          target.durationMinutes,
          now,
          horizonEnd,
          vats,
          cleared,
          pref,
          rules.slotStepMinutes,
        );
        if (retry) {
          // 只把实际与目标槽位重叠的可让位批次挤走；没挤到人说明仍无位置
          const hitIds = candidates
            .filter((b) => overlap(b.slot!, retry.slot))
            .map((b) => b.id);
          if (hitIds.length) {
            found = retry;
            displaced.push(...hitIds);
            break;
          }
        }
      }
      if (found) {
        batches = batches.map((b) =>
          displaced.includes(b.id)
            ? { ...b, slot: undefined, status: '待排' as const, blockers: [] }
            : b,
        );
      }
    }

    const cur = batches.find((b) => b.id === target.id)!;
    if (found) {
      cur.slot = found.slot;
      cur.status = '已排';
      cur.blockers = [];
      cur.updatedAt = now;
      // 被挤走的批次写回待排原因
      for (const id of displaced) {
        const d = batches.find((b) => b.id === id);
        if (d) {
          d.blockers = [{ kind: '机器重叠', detail: `加急批次 ${cur.id} 提前占用，退回待重排` }];
        }
      }
      result.placed.push({ batchId: cur.id, slot: found.slot, displaced });
    } else {
      result.remaining.push({
        batchId: cur.id,
        reason: rules.horizonDays + ' 天窗口内无可用染缸空档',
      });
    }
  }

  return { batches, result };
}

// ---------- 手动占位 / 加急提前 ----------

export interface ManualPlan {
  batches: Batch[];
  displaced: Batch[];
}

export type ManualError =
  | { ok: false; code: 'anchor_conflict'; detail: string }
  | { ok: false; code: 'conflict'; detail: string }
  | { ok: false; code: 'vat_inactive'; detail: string }
  | { ok: false; code: 'not_ready'; detail: string };

export type ManualResult = (ManualError | { ok: true; plan: ManualPlan }) & {
  ok: boolean;
};

/**
 * 手动把批次放到指定染缸与开始时刻。
 * - 与开染/完成锚点重叠 → 一律拒绝（已开染安排不能打乱）。
 * - rushPreempt=true 且为加急：允许把普通已排批次挤回待排。
 * - 否则任何重叠均拒绝。
 */
export function manualPlace(
  batchesInput: Batch[],
  vats: Vat[],
  rules: RuleSettings,
  batchId: string,
  vatId: string,
  startInput: number,
  now: number,
): ManualResult {
  const vat = vats.find((v) => v.id === vatId);
  if (!vat || !vat.active) return { ok: false, code: 'vat_inactive', detail: '染缸停用或不存在' };

  const batches = batchesInput.map((b) => ({ ...b }));
  const target = batches.find((b) => b.id === batchId);
  if (!target) return { ok: false, code: 'not_ready', detail: '批次不存在' };
  if (!isReady(target)) {
    return { ok: false, code: 'not_ready', detail: '色差目标未定或配方未复核' };
  }

  const start = Math.max(
    snapToStep(startInput, rules.slotStepMinutes),
    snapToStep(now, rules.slotStepMinutes),
  );
  const slot: Slot = {
    vatId,
    start,
    end: slotEnd(start, target.durationMinutes),
  };

  const others = batches.filter((b) => b.id !== batchId);
  const anchors = others.filter((b) => b.status === '开染' || b.status === '完成');
  const anchorHit = anchors.filter((b) => b.slot && overlap(b.slot!, slot));
  if (anchorHit.length) {
    return {
      ok: false,
      code: 'anchor_conflict',
      detail: `与已开染批次 ${anchorHit.map((b) => b.id).join('、')} 冲突，已开染安排不可打乱`,
    };
  }

  const busy = others.filter(
    (b) =>
      (b.slot && overlap(b.slot, slot)) ||
      (b.held && overlap(b.held.slot, slot)),
  );

  const preemptible =
    target.rush && rules.rushPreempt
      ? busy.filter((b) => b.status === '已排' && !b.rush && b.slot && !b.held)
      : [];
  const hard = busy.filter((b) => !preemptible.includes(b));
  if (hard.length) {
    return {
      ok: false,
      code: 'conflict',
      detail:
        `染缸 ${vat.name} 该时段与 ${hard
          .map((b) => `${b.id}（${b.status}）`)
          .join('、')} 重叠`,
    };
  }

  const displaced: Batch[] = [];
  for (const d of preemptible) {
    d.slot = undefined;
    d.status = '待排';
    d.blockers = [{ kind: '机器重叠', detail: `加急批次 ${target.id} 提前占用，退回待重排` }];
    d.updatedAt = now;
    displaced.push({ ...d });
  }

  target.slot = slot;
  target.status = '已排';
  target.blockers = [];
  target.updatedAt = now;

  return { ok: true, plan: { batches, displaced } };
}

// ---------- 变更 → 退回待确认 ----------

/** 哪些字段变化会触发退回待确认 */
export const TRIGGER_FIELDS: {
  key: keyof Batch;
  code: ChangeCode;
  label: string;
}[] = [
  { key: 'recipe', code: '配方变更', label: '配方（编号/组成/复核状态）' },
  { key: 'holdMinutes', code: '保温时间变更', label: '保温时间' },
  { key: 'finishing', code: '后整理变更', label: '后整理方式' },
  { key: 'durationMinutes', code: '染程时长变更', label: '预计染程时长' },
];

export function detectChanges(
  oldBatch: Batch,
  patch: Partial<Batch>,
): { field: string; code: ChangeCode; changed: boolean }[] {
  return TRIGGER_FIELDS.map((f) => {
    const a = oldBatch[f.key];
    const b = patch[f.key];
    let changed = false;
    if (f.key === 'recipe') {
      changed =
        b !== undefined &&
        JSON.stringify(a) !== JSON.stringify(b);
    } else {
      changed = b !== undefined && a !== b;
    }
    return { field: f.label, code: f.code, changed };
  });
}

// ---------- 交期风险 ----------

export type RiskLevel = '已逾期' | '高风险' | '预警' | '正常' | '无排期';

export function deliveryRisk(
  b: Batch,
  rules: RuleSettings,
  now: number,
): { level: RiskLevel; detail: string } {
  if (b.status === '完成') return { level: '正常', detail: '已完成' };
  if (!b.slot) {
    if (b.status === '待确认') {
      return { level: '高风险', detail: '变更待确认，旧排期冻结中' };
    }
    return { level: '无排期', detail: '尚无排期' };
  }
  const buffer = b.slot.end - b.dueAt;
  if (b.slot.end > b.dueAt || (b.status === '待排' && now > b.dueAt)) {
    return { level: '已逾期', detail: '染程结束晚于交期' };
  }
  if (buffer < rules.riskBufferHours * HOUR_MS) {
    return { level: '高风险', detail: `完工距交期不足 ${rules.riskBufferHours} 小时缓冲` };
  }
  if (b.dueAt - now < rules.riskSoonHours * HOUR_MS) {
    return { level: '预警', detail: `${rules.riskSoonHours} 小时内到期` };
  }
  return { level: '正常', detail: '排期可满足交期' };
}

export function riskSummary(
  batches: Batch[],
  rules: RuleSettings,
  now: number,
): Record<RiskLevel, Batch[]> {
  const out: Record<RiskLevel, Batch[]> = {
    已逾期: [],
    高风险: [],
    预警: [],
    正常: [],
    无排期: [],
  };
  for (const b of batches) out[deliveryRisk(b, rules, now).level].push(b);
  return out;
}
