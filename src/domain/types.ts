// 领域模型：染缸预约排程台
// 排程状态机：
//   pending（待排）→ scheduled（已排）→ running（开染中）→ done（已完成）
//                         ↓ 工艺/规则变更
//                       review（待确认，保留旧排期与原因）

export type BatchStatus =
  | "pending" // 待排
  | "scheduled" // 已排
  | "review" // 待确认（旧排期保留）
  | "running" // 开染中（锁定，不可打乱）
  | "done"; // 已完成

export interface Machine {
  id: string;
  name: string;
  enabled: boolean;
  note: string;
}

export interface Slot {
  machineId: string;
  startAt: string; // ISO
  endAt: string; // ISO
}

/** 旧排期快照（待确认批次保留） */
export interface KeptSlot extends Slot {
  reason: string;
}

export interface ProcessInfo {
  recipeNo: string; // 配方编号
  recipeReviewed: boolean; // 配方是否已复核
  durationMin: number; // 预计染程（分钟）
  holdMin: number; // 保温时间（分钟）
  finish: string; // 后整理方式
}

export interface Batch {
  id: string;
  orderNo: string; // 订单号
  customer: string;
  fabric: string; // 面料
  colorTarget: number | null; // 色差目标 ΔE 上限；null = 未定
  process: ProcessInfo;
  dueAt: string | null; // 交期 ISO
  rush: boolean; // 加急
  note: string;
  status: BatchStatus;
  slot: Slot | null;
  previousSlot: KeptSlot | null;
  createdAt: string;
}

export interface Rules {
  bufferMin: number; // 缸间缓冲（清缸/转产）分钟
  horizonDays: number; // 可排产周期（天）
  slotStepMin: number; // 排程刻度（分钟）
  workStartMin: number | null; // 每日可排产时段起（分钟），null = 全天
  workEndMin: number | null; // 每日可排产时段止
  warnBeforeDueHours: number; // 交期风险预警小时数
}

export interface State {
  machines: Machine[];
  batches: Batch[];
  rules: Rules;
}

export interface LogEntry {
  id: string;
  ts: string;
  type: string;
  batchId?: string;
  message: string;
}

export interface BatchInput {
  orderNo: string;
  customer: string;
  fabric: string;
  colorTarget: number | null;
  process: ProcessInfo;
  dueAt: string | null;
  rush: boolean;
  note: string;
}
