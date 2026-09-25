// 批次档案：localStorage 仓储 + 初始演示数据
import type { Batch, HistoryEntry, RuleSettings, StoreState, Vat } from '../domain/types';
import { DEFAULT_RULES, DAY_MS, HOUR_MS, slotEnd } from '../domain/scheduling';

const STORAGE_KEY = 'dye-reservation-v1';

function uid(prefix: string): string {
  return prefix + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
}

export function newId(kind: 'batch' | 'history' = 'batch'): string {
  return uid(kind === 'batch' ? 'PC' : 'LOG');
}

function atToday(hour: number, minute = 0, dayOffset = 0): number {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

export function seedState(now = Date.now()): StoreState {
  const vats: Vat[] = [
    { id: 'V1', name: 'D-01', spec: '500kg / 140℃ 高温缸', active: true },
    { id: 'V2', name: 'D-02', spec: '500kg / 140℃ 高温缸', active: true },
    { id: 'V3', name: 'D-03', spec: '300kg / 98℃ 常温缸', active: true },
    { id: 'V4', name: 'D-04', spec: '300kg / 98℃ 常温缸', active: true },
  ];

  const rules: RuleSettings = { ...DEFAULT_RULES };

  // 找一个“今天 08:00”作为排程锚点，保证演示数据落在相对当前的合理位置
  const today08 = atToday(8, 0, 0);
  const mkSlot = (vatId: string, dayOffset: number, hour: number, minutes: number) => {
    const start = today08 + dayOffset * DAY_MS + (hour - 8) * HOUR_MS;
    return { vatId, start, end: slotEnd(start, minutes) };
  };

  const batches: Batch[] = [
    {
      id: 'PC-A1001',
      orderNo: 'SO-2409-118',
      customer: '华盛服饰',
      fabric: '涤棉 65/35 双面布 180g/㎡',
      colorTarget: 'ΔE ≤ 1.0（对标准光源 D65）',
      recipe: { code: 'RF-2031', composition: '分散橙 0.8% / 活性红 1.2% / 元明粉 40g/L', reviewed: true },
      holdMinutes: 40,
      finishing: '柔软定型 150℃ × 3min',
      durationMinutes: 360,
      dueAt: today08 + 2 * DAY_MS,
      rush: false,
      status: '开染',
      slot: mkSlot('V1', 0, 8, 360),
      createdAt: today08 - 3 * DAY_MS,
      updatedAt: today08,
    },
    {
      id: 'PC-A1002',
      orderNo: 'SO-2409-121',
      customer: '青禾户外',
      fabric: '全涤网眼布 90g/㎡',
      colorTarget: 'ΔE ≤ 0.8',
      recipe: { code: 'RF-2044', composition: '分散蓝 2.1% / 匀染剂 1g/L', reviewed: true },
      holdMinutes: 35,
      finishing: '吸湿排汗 160℃ × 2min',
      durationMinutes: 300,
      dueAt: today08 + 1 * DAY_MS,
      rush: true,
      status: '待排',
      preferredVatId: 'V1',
      preferredStart: today08 + 6 * HOUR_MS,
      createdAt: now - 2 * HOUR_MS,
      updatedAt: now - 2 * HOUR_MS,
      blockers: [
        { kind: '机器重叠', detail: '期望染缸 D-01 该时段与 PC-A1001（开染）重叠' },
      ],
    },
    {
      id: 'PC-A1003',
      orderNo: 'SO-2409-125',
      customer: '华盛服饰',
      fabric: '棉氨汗布 200g/㎡',
      colorTarget: '',
      recipe: { code: 'RF-2050', composition: '活性黄 1.5% / 纯碱 15g/L（打样中）', reviewed: false },
      holdMinutes: 45,
      finishing: '预缩 + 磨毛',
      durationMinutes: 330,
      dueAt: today08 + 4 * DAY_MS,
      rush: false,
      status: '待排',
      createdAt: now - 5 * HOUR_MS,
      updatedAt: now - 5 * HOUR_MS,
      blockers: [
        { kind: '颜色未定', detail: '色差目标（ΔE）尚未填写' },
        { kind: '配方未复核', detail: '配方 RF-2050 未经工艺员复核' },
      ],
    },
    {
      id: 'PC-A1004',
      orderNo: 'SO-2409-119',
      customer: '南锦家纺',
      fabric: '全棉斜纹 260g/㎡',
      colorTarget: 'ΔE ≤ 1.2',
      recipe: { code: 'RF-2037', composition: '还原靛蓝 3.0% / 保险粉 8g/L', reviewed: true },
      holdMinutes: 50,
      finishing: '免烫整理 150℃ × 4min',
      durationMinutes: 420,
      dueAt: today08 + 3 * DAY_MS,
      rush: false,
      status: '已排',
      slot: mkSlot('V2', 0, 14, 420),
      createdAt: today08 - 1 * DAY_MS,
      updatedAt: today08 - 3 * HOUR_MS,
    },
    {
      id: 'PC-A1005',
      orderNo: 'SO-2409-122',
      customer: '青禾户外',
      fabric: '锦纶塔丝隆 120g/㎡',
      colorTarget: 'ΔE ≤ 1.0',
      recipe: { code: 'RF-2041', composition: '酸性红 1.1% / 醋酸 0.5g/L', reviewed: true },
      holdMinutes: 40,
      finishing: '涂层 + 定型 170℃ × 1.5min',
      durationMinutes: 300,
      dueAt: today08 + 5 * DAY_MS,
      rush: false,
      status: '待确认',
      slot: mkSlot('V3', 1, 9, 300),
      held: {
        slot: mkSlot('V3', 1, 9, 300),
        reasons: ['配方变更'],
        note: '客户追加荧光剂，配方由工艺员改单，等待重新复核',
      },
      createdAt: today08 - 1 * DAY_MS,
      updatedAt: now - 26 * HOUR_MS,
    },
    {
      id: 'PC-A1006',
      orderNo: 'SO-2409-126',
      customer: '鹿鸣童装',
      fabric: '全棉法兰绒 240g/㎡',
      colorTarget: 'ΔE ≤ 1.5',
      recipe: { code: 'RF-2052', composition: '活性翠蓝 1.8% / 元明粉 50g/L', reviewed: true },
      holdMinutes: 40,
      finishing: '柔软 + 预缩',
      durationMinutes: 360,
      dueAt: today08 + 6 * DAY_MS,
      rush: false,
      status: '已排',
      slot: mkSlot('V4', 1, 13, 360),
      createdAt: today08 - 6 * HOUR_MS,
      updatedAt: today08 - 4 * HOUR_MS,
    },
  ];

  const history: HistoryEntry[] = [
    {
      id: newId('history'),
      at: today08 - 3 * DAY_MS,
      kind: '登记',
      batchId: 'PC-A1001',
      operator: '业务员 林岚',
      detail: '登记批次，订单 SO-2409-118',
    },
    {
      id: newId('history'),
      at: today08,
      kind: '开染',
      batchId: 'PC-A1001',
      operator: '车间 老周',
      detail: 'D-01 08:00 开染，排期锁定',
    },
    {
      id: newId('history'),
      at: now - 26 * HOUR_MS,
      kind: '退回待确认',
      batchId: 'PC-A1005',
      operator: '工艺员 高敏',
      detail: '配方变更：客户追加荧光剂',
      before: 'RF-2041 酸性红 1.1%',
      after: 'RF-2041R 酸性红 1.1% + 荧光增白剂 0.3%',
    },
  ];

  return { batches, vats, rules, history };
}

export function loadState(): StoreState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoreState;
      if (parsed.batches && parsed.vats && parsed.rules) return parsed;
    }
  } catch {
    // 存储损坏时回退种子
  }
  const seeded = seedState();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
  } catch {
    // 隐私模式等场景忽略写入失败
  }
  return seeded;
}

export function saveState(state: StoreState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function resetState(): StoreState {
  const seeded = seedState();
  saveState(seeded);
  return seeded;
}
