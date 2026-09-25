// 全局状态：批次档案 / 染缸 / 排程规则 / 调整历史，localStorage 持久化

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type {
  Batch,
  BatchInput,
  LogEntry,
  Machine,
  Rules,
  State,
} from "../domain/types";
import * as engine from "../domain/engine";
import { seedLogs, seedState, DEFAULT_RULES } from "./seed";

const STORAGE_KEY = "dye-booking-v1";

interface PersistShape {
  state: State;
  logs: LogEntry[];
  seededAt: string;
}

export interface BatchUpdate extends Partial<BatchInput> {
  colorTarget?: number | null;
}

interface Store {
  state: State;
  logs: LogEntry[];
  now: Date;
  resetDemo: () => void;
  addBatch: (input: BatchInput) => void;
  updateBatch: (id: string, patch: BatchUpdate) => void;
  saveMachine: (m: Machine) => void;
  saveRules: (rules: Rules) => void;
  manualBook: (
    batchId: string,
    machineId: string,
    startLocal: string
  ) => string | null;
  autoSchedule: () => void;
  rushInsert: (batchId: string) => string | null;
  startDye: (batchId: string) => string | null;
  completeDye: (batchId: string) => string | null;
  resolveReview: (
    batchId: string,
    action: "keep" | "release" | "reschedule",
    manual?: { machineId: string; startLocal: string }
  ) => string | null;
  changeProcess: (batchId: string, patch: engine.ProcessPatch) => string | null;
}

function load(): PersistShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistShape;
      if (parsed.state?.batches && parsed.state?.rules) return parsed;
    }
  } catch {
    /* 损坏数据则重建 */
  }
  const now = new Date();
  return {
    state: seedState(now),
    logs: seedLogs(now),
    seededAt: now.toISOString(),
  };
}

let seq = 0;
function genId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

type Action =
  | { kind: "reset" }
  | { kind: "apply"; result: engine.EngineResult; extraLogs?: LogEntry[] }
  | { kind: "add"; batch: Batch }
  | { kind: "patchBatch"; id: string; patch: BatchUpdate }
  | { kind: "saveMachine"; machine: Machine }
  | { kind: "log"; entry: LogEntry };

interface Full {
  state: State;
  logs: LogEntry[];
}

function makeLog(e: engine.EngineEvent): LogEntry {
  return {
    id: genId("L"),
    ts: new Date().toISOString(),
    type: e.type,
    batchId: e.batchId,
    message: e.message,
  };
}

function reducer(prev: Full, action: Action): Full {
  switch (action.kind) {
    case "reset": {
      const now = new Date();
      return { state: seedState(now), logs: seedLogs(now) };
    }
    case "apply": {
      const logs = [
        ...action.result.events.map(makeLog),
        ...(action.extraLogs ?? []),
        ...prev.logs,
      ].slice(0, 2000);
      return { state: action.result.state, logs };
    }
    case "add":
      return {
        state: { ...prev.state, batches: [action.batch, ...prev.state.batches] },
        logs: [
          {
            id: genId("L"),
            ts: new Date().toISOString(),
            type: "register",
            batchId: action.batch.id,
            message: `登记批次 ${action.batch.id}（订单 ${action.batch.orderNo}，${action.batch.fabric}）`,
          },
          ...prev.logs,
        ],
      };
    case "patchBatch": {
      const batches = prev.state.batches.map((b) => {
        if (b.id !== action.id) return b;
        const { process, colorTarget, ...rest } = action.patch;
        return {
          ...b,
          ...rest,
          colorTarget:
            colorTarget === undefined ? b.colorTarget : colorTarget,
          process: process ? { ...b.process, ...process } : b.process,
        };
      });
      return { state: { ...prev.state, batches }, logs: prev.logs };
    }
    case "saveMachine": {
      const exists = prev.state.machines.some((m) => m.id === action.machine.id);
      const machines = exists
        ? prev.state.machines.map((m) =>
            m.id === action.machine.id ? action.machine : m
          )
        : [...prev.state.machines, action.machine];
      return {
        state: { ...prev.state, machines },
        logs: [
          {
            id: genId("L"),
            ts: new Date().toISOString(),
            type: "machine-change",
            message: `${exists ? "更新" : "新增"}染缸：${action.machine.name}${
              action.machine.enabled ? "" : "（已停用）"
            }`,
          },
          ...prev.logs,
        ],
      };
    }
    case "log":
      return { state: prev.state, logs: [action.entry, ...prev.logs] };
  }
}

const StoreContext = createContext<Store | null>(null);

function toIsoStart(local: string): string {
  // datetime-local 按本地时区解析
  const d = new Date(local);
  return d.toISOString();
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [full, dispatch] = useReducer(reducer, undefined, load);

  const commit = useCallback((result: engine.EngineResult) => {
    dispatch({ kind: "apply", result });
  }, []);

  const now = useMemo(() => new Date(), []);
  const nowIso = now.toISOString();

  const api: Store = useMemo(
    () => ({
      state: full.state,
      logs: full.logs,
      now,
      resetDemo: () => dispatch({ kind: "reset" }),

      addBatch: (input) => {
        const id = `DYE-${String(2400 + full.state.batches.length + 11).padStart(4, "0")}`;
        const batch: Batch = {
          id,
          ...input,
          status: "pending",
          slot: null,
          previousSlot: null,
          createdAt: new Date().toISOString(),
        };
        dispatch({ kind: "add", batch });
      },

      updateBatch: (id, patch) => dispatch({ kind: "patchBatch", id, patch }),

      saveMachine: (m) => dispatch({ kind: "saveMachine", machine: m }),

      saveRules: (rules) => {
        try {
          commit(engine.updateRules(full.state, rules, nowIso));
        } catch (e) {
          alert((e as Error).message);
        }
      },

      manualBook: (batchId, machineId, startLocal) => {
        try {
          commit(
            engine.manualBook(
              full.state,
              batchId,
              machineId,
              toIsoStart(startLocal),
              nowIso
            )
          );
          return null;
        } catch (e) {
          return (e as Error).message;
        }
      },

      autoSchedule: () => commit(engine.autoSchedule(full.state, nowIso)),

      rushInsert: (batchId) => {
        try {
          commit(engine.rushInsert(full.state, batchId, nowIso));
          return null;
        } catch (e) {
          return (e as Error).message;
        }
      },

      startDye: (batchId) => {
        try {
          commit(engine.startDye(full.state, batchId));
          return null;
        } catch (e) {
          return (e as Error).message;
        }
      },

      completeDye: (batchId) => {
        try {
          commit(engine.completeDye(full.state, batchId));
          return null;
        } catch (e) {
          return (e as Error).message;
        }
      },

      resolveReview: (batchId, action, manual) => {
        try {
          commit(
            engine.resolveReview(
              full.state,
              batchId,
              action,
              nowIso,
              manual
                ? {
                    machineId: manual.machineId,
                    startIso: toIsoStart(manual.startLocal),
                  }
                : undefined
            )
          );
          return null;
        } catch (e) {
          return (e as Error).message;
        }
      },

      changeProcess: (batchId, patch) => {
        try {
          commit(engine.changeProcess(full.state, batchId, patch));
          return null;
        } catch (e) {
          return (e as Error).message;
        }
      },
    }),
    [full, commit, now, nowIso]
  );

  // 持久化
  useEffect(() => {
    try {
      const shape: PersistShape = {
        state: full.state,
        logs: full.logs,
        seededAt: new Date().toISOString(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(shape));
    } catch {
      /* 存储不可用时静默 */
    }
  }, [full]);

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}

export { DEFAULT_RULES };
