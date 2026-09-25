// 领域类型：染缸预约台
// 所有时刻统一用 epoch 毫秒（number），便于纯函数比较与计算。

export type BatchStatus = '待排' | '已排' | '待确认' | '开染' | '完成';

/** 染程（保温/后整理）变更原因代码，展示时映射中文 */
export type ChangeCode = '配方变更' | '保温时间变更' | '后整理变更' | '染程时长变更';

/** 挡在「待排」的原因（未通过开排校验） */
export type Blocker =
  | { kind: '颜色未定'; detail: string }
  | { kind: '配方未复核'; detail: string }
  | { kind: '机器重叠'; detail: string };

export interface Recipe {
  /** 配方编号，如 RF-2031 */
  code: string;
  /** 配方组成摘要，如 活性红 1.2% / 元明粉 40g/L */
  composition: string;
  /** 是否经工艺员复核 */
  reviewed: boolean;
}

export interface Slot {
  vatId: string;
  /** 开始时刻（epoch ms） */
  start: number;
  /** 结束时刻（epoch ms），开始 + 预计染程 */
  end: number;
}

/** 待确认批次保留的旧排期及退回原因 */
export interface HeldSlot {
  slot: Slot;
  reasons: ChangeCode[];
  /** 每次触发退回时登记的说明（含时间，见 history） */
  note?: string;
}

export interface Batch {
  id: string;
  /** 订单号 */
  orderNo: string;
  fabric: string;
  /** 客户 */
  customer?: string;
  /** 色差目标，如 ΔE ≤ 1.0；为空视为未定 */
  colorTarget?: string;
  recipe: Recipe;
  /** 保温时间（分钟） */
  holdMinutes: number;
  /** 后整理方式，如 柔软定型 150℃×3min */
  finishing: string;
  /** 预计染程（分钟）——决定占位时长 */
  durationMinutes: number;
  /** 交期（epoch ms） */
  dueAt: number;
  rush: boolean;
  status: BatchStatus;
  /** 当前生效排期（已排 / 开染 / 完成） */
  slot?: Slot;
  /** 待确认时保留的旧排期与原因 */
  held?: HeldSlot;
  /** 仍在待排时的阻碍列表 */
  blockers?: Blocker[];
  /** 登记时期望的染缸与开始时刻（可选） */
  preferredVatId?: string;
  preferredStart?: number;
  createdAt: number;
  updatedAt: number;
}

export interface Vat {
  id: string;
  /** 染缸编号，如 D-01 */
  name: string;
  /** 容量/规格说明 */
  spec: string;
  active: boolean;
}

/** 排程规则（规则页可维护） */
export interface RuleSettings {
  /** 时间粒度（分钟），手动占位吸附 */
  slotStepMinutes: number;
  /** 自动排程从现在起向前搜索的窗口（天） */
  horizonDays: number;
  /** 交期风险阈值（小时） */
  riskSoonHours: number;
  /** 提前量：开染结束距交期小于该小时数即预警 */
  riskBufferHours: number;
  /** 自动排程是否允许加急插到普通已排批次之前并把后者挤走重排 */
  rushPreempt: boolean;
}

export type HistoryKind =
  | '登记'
  | '自动排程'
  | '手动占位'
  | '加急提前'
  | '退回待确认'
  | '确认重排'
  | '开染'
  | '完成'
  | '编辑'
  | '规则变更'
  | '染缸维护';

export interface HistoryEntry {
  id: string;
  at: number;
  kind: HistoryKind;
  batchId?: string;
  operator: string;
  detail: string;
  /** 变更前/后片段，便于审计 */
  before?: string;
  after?: string;
}

export interface StoreState {
  batches: Batch[];
  vats: Vat[];
  rules: RuleSettings;
  history: HistoryEntry[];
}
