// 应用状态：编排规则引擎（domain）与批次档案（data），登记调整历史
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from 'react';
import type {
  Batch,
  ChangeCode,
  HistoryEntry,
  HistoryKind,
  Recipe,
  RuleSettings,
  StoreState,
} from '../domain/types';
import {
  autoSchedule,
  blockersFor,
  conflictsOn,
  deliveryRisk,
  detectChanges,
  isReady,
  manualPlace,
  occupiedSlots,
  slotEnd,
} from '../domain/scheduling';
import { loadState, newId, resetState, saveState } from '../data/store';

export interface BatchDraft {
  orderNo: string;
  customer: string;
  fabric: string;
  colorTarget: string;
  recipeCode: string;
  recipeComposition: string;
  recipeReviewed: boolean;
  holdMinutes: number;
  finishing: string;
  durationMinutes: number;
  dueAt?: number;
  rush: boolean;
  preferredVatId: string;
  preferredStart?: number;
}

export const emptyDraft = (): BatchDraft => ({
  orderNo: '',
  customer: '',
  fabric: '',
  colorTarget: '',
  recipeCode: '',
  recipeComposition: '',
  recipeReviewed: false,
  holdMinutes: 40,
  finishing: '',
  durationMinutes: 300,
  dueAt: undefined,
  rush: false,
  preferredVatId: '',
  preferredStart: undefined,
});

export function draftFromBatch(b: Batch): BatchDraft {
  return {
    orderNo: b.orderNo,
    customer: b.customer ?? '',
    fabric: b.fabric,
    colorTarget: b.colorTarget ?? '',
    recipeCode: b.recipe.code,
    recipeComposition: b.recipe.composition,
    recipeReviewed: b.recipe.reviewed,
    holdMinutes: b.holdMinutes,
    finishing: b.finishing,
    durationMinutes: b.durationMinutes,
    dueAt: b.dueAt,
    rush: b.rush,
    preferredVatId: b.preferredVatId ?? '',
    preferredStart: b.preferredStart,
  };
}

export interface Notice {
  id: number;
  level: 'ok' | 'err';
  text: string;
}

interface AppState extends StoreState {
  notice?: Notice;
}

type Action =
  | { type: 'addBatch'; draft: BatchDraft; operator: string }
  | { type: 'updateBatch'; id: string; draft: BatchDraft; operator: string }
  | { type: 'autoSchedule'; operator: string }
  | { type: 'manualPlace'; id: string; vatId: string; start: number; operator: string }
  | { type: 'confirmReschedule'; id: string; operator: string }
  | { type: 'returnToPending'; id: string; operator: string }
  | { type: 'markStarted'; id: string; operator: string }
  | { type: 'markDone'; id: string; operator: string }
  | { type: 'updateRules'; rules: RuleSettings; operator: string }
  | { type: 'toggleVat'; vatId: string; operator: string }
  | { type: 'resetDemo' }
  | { type: 'clearNotice' };

interface Ctx extends StoreState {
  now: number;
  operator: string;
  setOperator: (s: string) => void;
  notice: Notice | null;
  dispatch: React.Dispatch<Action>;
}

let noticeSeq = 1;

function entry(
  kind: HistoryKind,
  operator: string,
  detail: string,
  extra?: Partial<HistoryEntry>,
): HistoryEntry {
  return { id: newId('history'), at: Date.now(), kind, operator, detail, ...extra };
}

function ok(text: string): { notice: Notice } {
  return { notice: { id: noticeSeq++, level: 'ok', text } };
}
function err(text: string): { notice: Notice } {
  return { notice: { id: noticeSeq++, level: 'err', text } };
}

function draftRecipe(d: BatchDraft): Recipe {
  return {
    code: d.recipeCode.trim(),
    composition: d.recipeComposition.trim(),
    reviewed: d.recipeReviewed,
  };
}

/** 重算待排批次的阻碍（登记、编辑、开染锁定后调用） */
function recomputeBlockers(state: AppState): AppState {
  let changed = false;
  const occupied = occupiedSlots(state.batches);
  const batches = state.batches.map((b) => {
    if (b.status !== '待排') return b;
    const blockers = blockersFor(b, occupied, state.vats);
    const same =
      blockers.length === (b.blockers?.length ?? 0) &&
      blockers.every((x, i) => x.kind === b.blockers?.[i]?.kind);
    if (!same) {
      changed = true;
      return { ...b, blockers: blockers.length ? blockers : undefined };
    }
    return b;
  });
  return changed ? { ...state, batches } : state;
}

function reducer(prev: AppState, action: Action): AppState {
  if (action.type === 'clearNotice') return { ...prev, notice: undefined };
  if (action.type === 'resetDemo') return { ...resetState(), ...ok('已恢复演示数据') };

  const now = Date.now();

  switch (action.type) {
    case 'addBatch': {
      const d = action.draft;
      const batch: Batch = {
        id: newId('batch'),
        orderNo: d.orderNo.trim(),
        customer: d.customer.trim() || undefined,
        fabric: d.fabric.trim(),
        colorTarget: d.colorTarget.trim(),
        recipe: draftRecipe(d),
        holdMinutes: d.holdMinutes,
        finishing: d.finishing.trim(),
        durationMinutes: d.durationMinutes,
        dueAt: d.dueAt ?? now + 3 * 86_400_000,
        rush: d.rush,
        status: '待排',
        preferredVatId: d.preferredVatId || undefined,
        preferredStart: d.preferredStart,
        createdAt: now,
        updatedAt: now,
      };
      let state: AppState = { ...prev, batches: [...prev.batches, batch] };
      state = recomputeBlockers(state);
      const saved = state.batches.find((b) => b.id === batch.id)!;
      const blockerText = saved.blockers?.length
        ? `，留待排：${saved.blockers.map((b) => b.kind).join('、')}`
        : '，可参与排程';
      state = {
        ...state,
        history: [
          entry('登记', action.operator, `登记批次 ${batch.id}，订单 ${batch.orderNo}${blockerText}`, {
            batchId: batch.id,
            after: `${batch.fabric}｜目标 ${batch.colorTarget || '未定'}｜配方 ${batch.recipe.code}（${batch.recipe.reviewed ? '已复核' : '未复核'}）`,
          }),
          ...state.history,
        ],
        ...ok(`批次 ${batch.id} 已登记${blockerText}`),
      };
      return state;
    }

    case 'updateBatch': {
      const idx = prev.batches.findIndex((b) => b.id === action.id);
      if (idx < 0) return prev;
      const old = prev.batches[idx];
      const d = action.draft;

      const patch: Partial<Batch> = {
        orderNo: d.orderNo.trim(),
        customer: d.customer.trim() || undefined,
        fabric: d.fabric.trim(),
        colorTarget: d.colorTarget.trim(),
        recipe: draftRecipe(d),
        holdMinutes: d.holdMinutes,
        finishing: d.finishing.trim(),
        durationMinutes: d.durationMinutes,
        dueAt: d.dueAt ?? old.dueAt,
        rush: d.rush,
        preferredVatId: d.preferredVatId || undefined,
        preferredStart: d.preferredStart,
      };

      const changes = detectChanges(old, patch).filter((c) => c.changed);
      const lockable = old.status === '已排' || old.status === '待确认';
      const triggers = changes.filter((c) =>
        ['配方变更', '保温时间变更', '后整理变更', '染程时长变更'].includes(c.code),
      );

      let next: Batch = { ...old, ...patch, updatedAt: now };
      const entries: HistoryEntry[] = [];

      if (changes.length) {
        entries.push(
          entry('编辑', action.operator, `编辑批次 ${old.id}：${changes.map((c) => c.field).join('、')}`, {
            batchId: old.id,
          }),
        );
      }

      let noticeText = `${old.id} 已保存`;
      if (lockable && triggers.length) {
        // 关键工艺变更 → 退回待确认，保留旧排期与原因
        const reasons = triggers.map((t) => t.code) as ChangeCode[];
        const heldReasons =
          old.status === '待确认' && old.held
            ? Array.from(new Set([...old.held.reasons, ...reasons]))
            : reasons;
        const heldSlot = old.held?.slot ?? old.slot!;
        next.status = '待确认';
        next.slot = old.slot; // 旧排期在时间轴上冻结显示
        next.held = {
          slot: heldSlot,
          reasons: heldReasons,
          note: `${reasons.join('、')}（${action.operator} 修改，待确认）`,
        };
        next.blockers = undefined;
        entries.push(
          entry('退回待确认', action.operator, `${old.id} 因${reasons.join('、')}退回待确认，旧排期保留`, {
            batchId: old.id,
            before: `旧排期 ${prev.vats.find((v) => v.id === heldSlot.vatId)?.name} ${new Date(heldSlot.start).toLocaleString('zh-CN')}`,
            after: reasons.join('、'),
          }),
        );
        noticeText = `${old.id} 因${reasons.join('、')}退回待确认，旧排期已保留`;
      }

      const batches = prev.batches.slice();
      batches[idx] = next;
      let state: AppState = { ...prev, batches };
      state = recomputeBlockers(state);
      state = { ...state, history: [...entries, ...state.history].slice(0, 500), ...ok(noticeText) };
      return state;
    }

    case 'autoSchedule': {
      const { batches, result } = autoSchedule(prev.batches, prev.vats, prev.rules, now);
      const log: HistoryEntry[] = [];
      for (const p of result.placed) {
        const b = batches.find((x) => x.id === p.batchId)!;
        log.push(
          entry(
            p.displaced.length ? '加急提前' : '自动排程',
            action.operator,
            p.displaced.length
              ? `加急批次 ${p.batchId} 提前占用，挤退 ${p.displaced.join('、')}`
              : `自动排程 ${p.batchId}`,
            {
              batchId: p.batchId,
              after: `${prev.vats.find((v) => v.id === p.slot.vatId)?.name} ${new Date(p.slot.start).toLocaleString('zh-CN')} 起 ${b.durationMinutes} 分钟`,
            },
          ),
        );
      }
      for (const r of result.remaining) {
        log.push(
          entry('自动排程', action.operator, `${r.batchId} 未能排入：${r.reason}`, {
            batchId: r.batchId,
          }),
        );
      }
      const text = result.placed.length
        ? `已排入 ${result.placed.length} 个批次${result.remaining.length ? `，${result.remaining.length} 个窗口内排不下` : ''}`
        : '本轮没有可排入的批次（待排批次均存在阻碍，或窗口内无空档）';
      return {
        ...prev,
        batches,
        history: [...[...log].reverse(), ...prev.history].slice(0, 500),
        ...(result.placed.length ? ok(text) : err(text)),
      };
    }

    case 'manualPlace': {
      const res = manualPlace(prev.batches, prev.vats, prev.rules, action.id, action.vatId, action.start, now);
      if (!res.ok) return { ...prev, ...err(res.detail) };
      const b = res.plan.batches.find((x) => x.id === action.id)!;
      const logEntry = entry(
        b.rush && res.plan.displaced.length ? '加急提前' : '手动占位',
        action.operator,
        res.plan.displaced.length
          ? `${b.id} 加急提前，挤退 ${res.plan.displaced.map((x) => x.id).join('、')}`
          : `手动占位 ${b.id}`,
        {
          batchId: b.id,
          after: `${prev.vats.find((v) => v.id === action.vatId)?.name} ${new Date(b.slot!.start).toLocaleString('zh-CN')}`,
        },
      );
      let state: AppState = { ...prev, batches: res.plan.batches };
      state = recomputeBlockers(state);
      return {
        ...state,
        history: [logEntry, ...state.history].slice(0, 500),
        ...ok(
          res.plan.displaced.length
            ? `${b.id} 已提前占位，${res.plan.displaced.map((x) => x.id).join('、')} 退回待排`
            : `${b.id} 已占位`,
        ),
      };
    }

    case 'confirmReschedule': {
      const idx = prev.batches.findIndex((b) => b.id === action.id);
      if (idx < 0) return prev;
      const old = prev.batches[idx];
      if (old.status !== '待确认' || !old.held) return prev;

      if (!isReady(old)) {
        return { ...prev, ...err('色差目标未定或配方未复核，不能确认') };
      }

      const held = old.held.slot;
      const durChanged = held.end - held.start !== old.durationMinutes * 60_000;
      const wantedSlot = durChanged ? { ...held, end: slotEnd(held.start, old.durationMinutes) } : held;

      const anchors = prev.batches
        .filter((b) => b.id !== old.id && (b.status === '开染' || b.status === '完成') && b.slot)
        .map((b) => b.slot!);
      if (conflictsOn(wantedSlot, anchors).length) {
        return { ...prev, ...err('旧排期与已开染安排冲突，请改用“退回待排”后重新占位') };
      }
      const others = occupiedSlots(prev.batches.filter((b) => b.id !== old.id));
      if (conflictsOn(wantedSlot, others).length) {
        return { ...prev, ...err('旧排期现与其他已排/待确认安排冲突，请退回待排后重排') };
      }

      const next: Batch = {
        ...old,
        status: '已排',
        slot: wantedSlot,
        held: undefined,
        blockers: undefined,
        updatedAt: now,
      };
      const batches = prev.batches.slice();
      batches[idx] = next;
      const logEntry = entry('确认重排', action.operator, `${old.id} 工艺变更确认，沿用旧排期`, {
        batchId: old.id,
        before: `退回原因：${old.held.reasons.join('、')}`,
        after: `${prev.vats.find((v) => v.id === wantedSlot.vatId)?.name} ${new Date(wantedSlot.start).toLocaleString('zh-CN')}`,
      });
      return {
        ...prev,
        batches,
        history: [logEntry, ...prev.history].slice(0, 500),
        ...ok(`${old.id} 已确认并恢复排期`),
      };
    }

    case 'returnToPending': {
      const idx = prev.batches.findIndex((b) => b.id === action.id);
      if (idx < 0) return prev;
      const old = prev.batches[idx];
      if (old.status !== '待确认') return prev;
      const next: Batch = {
        ...old,
        status: '待排',
        slot: undefined,
        held: undefined,
        blockers: undefined,
        updatedAt: now,
      };
      const batches = prev.batches.slice();
      batches[idx] = next;
      let state: AppState = { ...prev, batches };
      state = recomputeBlockers(state);
      const logEntry = entry('确认重排', action.operator, `${old.id} 不沿用旧排期，退回待排重新安排`, {
        batchId: old.id,
        before: old.held ? old.held.reasons.join('、') : undefined,
      });
      return {
        ...state,
        history: [logEntry, ...state.history].slice(0, 500),
        ...ok(`${old.id} 已退回待排，可重新占位`),
      };
    }

    case 'markStarted': {
      const idx = prev.batches.findIndex((b) => b.id === action.id);
      if (idx < 0) return prev;
      const old = prev.batches[idx];
      if (old.status !== '已排' || !old.slot) return prev;
      const step = prev.rules.slotStepMinutes * 60_000;
      const start = Math.floor(now / step) * step;
      const slot = { ...old.slot, start, end: slotEnd(start, old.durationMinutes) };
      const next: Batch = { ...old, status: '开染', slot, updatedAt: now };
      const batches = prev.batches.slice();
      batches[idx] = next;
      const logEntry = entry('开染', action.operator, `${old.id} 开染，排期锁定不可再打乱`, {
        batchId: old.id,
        after: `${prev.vats.find((v) => v.id === slot.vatId)?.name} 至 ${new Date(slot.end).toLocaleString('zh-CN')}`,
      });
      let state: AppState = { ...prev, batches, history: [logEntry, ...prev.history].slice(0, 500) };
      state = recomputeBlockers(state);
      return { ...state, ...ok(`${old.id} 已开染，该安排已锁定`) };
    }

    case 'markDone': {
      const idx = prev.batches.findIndex((b) => b.id === action.id);
      if (idx < 0) return prev;
      const old = prev.batches[idx];
      if (old.status !== '开染') return prev;
      const batches = prev.batches.slice();
      batches[idx] = { ...old, status: '完成', updatedAt: now };
      const logEntry = entry('完成', action.operator, `${old.id} 染程结束，完工`, { batchId: old.id });
      return {
        ...prev,
        batches,
        history: [logEntry, ...prev.history].slice(0, 500),
        ...ok(`${old.id} 已完工`),
      };
    }

    case 'updateRules': {
      if (JSON.stringify(prev.rules) === JSON.stringify(action.rules)) return prev;
      const logEntry = entry('规则变更', action.operator, '排程规则已更新', {
        before: JSON.stringify(prev.rules),
        after: JSON.stringify(action.rules),
      });
      return {
        ...prev,
        rules: action.rules,
        history: [logEntry, ...prev.history].slice(0, 500),
        ...ok('排程规则已保存'),
      };
    }

    case 'toggleVat': {
      const vats = prev.vats.map((v) => (v.id === action.vatId ? { ...v, active: !v.active } : v));
      const v = vats.find((x) => x.id === action.vatId)!;
      const logEntry = entry('染缸维护', action.operator, `染缸 ${v.name} ${v.active ? '恢复启用' : '停用维护'}`);
      return {
        ...prev,
        vats,
        history: [logEntry, ...prev.history].slice(0, 500),
        ...ok(`染缸 ${v.name} 已${v.active ? '恢复启用' : '停用'}`),
      };
    }

    default:
      return prev;
  }
}

const ReservationCtx = createContext<Ctx | null>(null);

function usePersistedOperator() {
  const [v, setV] = useState<string>(() => {
    try {
      return localStorage.getItem('dye-operator') || '业务员 林岚';
    } catch {
      return '业务员 林岚';
    }
  });
  const set = useCallback((s: string) => {
    setV(s);
    try {
      localStorage.setItem('dye-operator', s);
    } catch {
      // ignore
    }
  }, []);
  return [v, set] as const;
}

export function ReservationProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState as () => AppState);
  const [operator, setOperator] = usePersistedOperator();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // 仅持久化档案部分，notice 不入存储
  useEffect(() => {
    const { notice: _n, ...persisted } = state;
    void _n;
    saveState(persisted);
  }, [state]);

  // notice 自动消失
  useEffect(() => {
    if (!state.notice) return;
    const t = setTimeout(() => dispatch({ type: 'clearNotice' }), 3600);
    return () => clearTimeout(t);
  }, [state.notice]);

  const value = useMemo<Ctx>(
    () => ({
      batches: state.batches,
      vats: state.vats,
      rules: state.rules,
      history: state.history,
      now,
      operator,
      setOperator,
      notice: state.notice ?? null,
      dispatch,
    }),
    [state, now, operator, setOperator],
  );

  return <ReservationCtx.Provider value={value}>{children}</ReservationCtx.Provider>;
}

export function useReservation(): Ctx {
  const ctx = useContext(ReservationCtx);
  if (!ctx) throw new Error('useReservation must be used within ReservationProvider');
  return ctx;
}

export { deliveryRisk };
