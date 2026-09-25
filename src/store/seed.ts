// 演示种子数据：日期相对当前时刻生成，开染/已排/待确认/待排各状态都有样例

import type { Batch, LogEntry, Machine, Rules, State } from "../domain/types";
import { pad2 } from "../domain/time";

export const DEFAULT_RULES: Rules = {
  bufferMin: 30,
  horizonDays: 7,
  slotStepMin: 15,
  workStartMin: 7 * 60,
  workEndMin: 22 * 60,
  warnBeforeDueHours: 12,
};

export function seedMachines(): Machine[] {
  return [
    { id: "M1", name: "1# 溢流染缸（500kg）", enabled: true, note: "棉/混纺" },
    { id: "M2", name: "2# 溢流染缸（500kg）", enabled: true, note: "棉/混纺" },
    { id: "M3", name: "3# 经轴染缸（300kg）", enabled: true, note: "涤纶" },
    { id: "M4", name: "4# 气流染色机（800kg）", enabled: true, note: "针织" },
  ];
}

interface SeedDef {
  id: string;
  orderNo: string;
  customer: string;
  fabric: string;
  colorTarget: number | null;
  recipeNo: string;
  recipeReviewed: boolean;
  durationMin: number;
  holdMin: number;
  finish: string;
  dueOffsetH: number | null;
  rush?: boolean;
  note?: string;
  status: Batch["status"];
  /** 相对今日基准时刻（今天 06:00）的小时偏移 */
  startOffsetH?: number;
  machineId?: string;
  reviewReason?: string;
}

function isoAt(base: Date, offsetH: number, min = 0): string {
  return new Date(base.getTime() + offsetH * 3600000 + min * 60000).toISOString();
}

export function seedState(now: Date = new Date()): State {
  // 基准：今天 06:00（早班）
  const base = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    6,
    0,
    0,
    0
  );

  const defs: SeedDef[] = [
    {
      id: "DYE-2401",
      orderNo: "SO-8812",
      customer: "恒泰服饰",
      fabric: "棉府绸 120g/㎡",
      colorTarget: 1.0,
      recipeNo: "R-C118",
      recipeReviewed: true,
      durationMin: 300,
      holdMin: 40,
      finish: "柔软整理 2%",
      dueOffsetH: 22,
      status: "running",
      startOffsetH: 2,
      machineId: "M1",
      note: "上午已开染，锁定",
    },
    {
      id: "DYE-2402",
      orderNo: "SO-8815",
      customer: "蓝海家纺",
      fabric: "涤纶针织 180g/㎡",
      colorTarget: 0.8,
      recipeNo: "R-P204",
      recipeReviewed: true,
      durationMin: 240,
      holdMin: 30,
      finish: "定型拉幅",
      dueOffsetH: 30,
      status: "scheduled",
      startOffsetH: 8,
      machineId: "M1",
    },
    {
      id: "DYE-2403",
      orderNo: "SO-8817",
      customer: "锦绣外贸",
      fabric: "混纺斜纹 220g/㎡",
      colorTarget: 1.2,
      recipeNo: "R-B077",
      recipeReviewed: true,
      durationMin: 360,
      holdMin: 45,
      finish: "预缩",
      dueOffsetH: 26,
      status: "scheduled",
      startOffsetH: 13,
      machineId: "M2",
    },
    {
      id: "DYE-2404",
      orderNo: "SO-8820",
      customer: "云端运动",
      fabric: "锦纶弹力布",
      colorTarget: 0.9,
      recipeNo: "R-N031",
      recipeReviewed: true,
      durationMin: 270,
      holdMin: 35,
      finish: "抗菌整理",
      dueOffsetH: 20,
      rush: true,
      status: "scheduled",
      startOffsetH: 9,
      machineId: "M3",
      note: "加急单",
    },
    {
      id: "DYE-2405",
      orderNo: "SO-8803",
      customer: "恒泰服饰",
      fabric: "棉汗布 160g/㎡",
      colorTarget: 1.0,
      recipeNo: "R-C121",
      recipeReviewed: true,
      durationMin: 300,
      holdMin: 40,
      finish: "柔软整理 2%",
      dueOffsetH: 18,
      status: "review",
      startOffsetH: 12.5,
      machineId: "M4",
      reviewReason: "后整理改为液氨丝光，待工艺确认",
    },
    {
      id: "DYE-2406",
      orderNo: "SO-8824",
      customer: "蓝海家纺",
      fabric: "涤纶磨毛布",
      colorTarget: 0.8,
      recipeNo: "R-P209",
      recipeReviewed: true,
      durationMin: 240,
      holdMin: 30,
      finish: "磨毛+定型",
      dueOffsetH: 40,
      status: "scheduled",
      startOffsetH: 16,
      machineId: "M3",
    },
    {
      id: "DYE-2407",
      orderNo: "SO-8826",
      customer: "南粤制衣",
      fabric: "棉麻平布",
      colorTarget: null, // 色差目标未定
      recipeNo: "R-C130",
      recipeReviewed: true,
      durationMin: 300,
      holdMin: 40,
      finish: "预缩",
      dueOffsetH: 44,
      status: "pending",
      note: "客户色卡未到",
    },
    {
      id: "DYE-2408",
      orderNo: "SO-8827",
      customer: "锦绣外贸",
      fabric: "锦棉交织",
      colorTarget: 1.1,
      recipeNo: "R-M018",
      recipeReviewed: false, // 配方未复核
      durationMin: 330,
      holdMin: 40,
      finish: "涂层",
      dueOffsetH: 50,
      status: "pending",
      note: "打样室复核中",
    },
    {
      id: "DYE-2409",
      orderNo: "SO-8828",
      customer: "云端运动",
      fabric: "涤纶网眼布",
      colorTarget: 0.7,
      recipeNo: "R-P212",
      recipeReviewed: true,
      durationMin: 210,
      holdMin: 25,
      finish: "吸湿排汗",
      dueOffsetH: 28,
      rush: true,
      status: "pending",
      note: "催单：客户要求提前",
    },
    {
      id: "DYE-2410",
      orderNo: "SO-8799",
      customer: "老客户补单",
      fabric: "棉斜纹 260g/㎡",
      colorTarget: 1.0,
      recipeNo: "R-C102",
      recipeReviewed: true,
      durationMin: 300,
      holdMin: 45,
      finish: "免烫整理",
      dueOffsetH: -4,
      status: "done",
      startOffsetH: -8,
      machineId: "M2",
      note: "昨天完工",
    },
  ];

  const batches: Batch[] = defs.map((d, i) => {
    const b: Batch = {
      id: d.id,
      orderNo: d.orderNo,
      customer: d.customer,
      fabric: d.fabric,
      colorTarget: d.colorTarget,
      process: {
        recipeNo: d.recipeNo,
        recipeReviewed: d.recipeReviewed,
        durationMin: d.durationMin,
        holdMin: d.holdMin,
        finish: d.finish,
      },
      dueAt: d.dueOffsetH === null ? null : isoAt(base, d.dueOffsetH),
      rush: !!d.rush,
      note: d.note ?? "",
      status: d.status,
      slot: null,
      previousSlot: null,
      createdAt: new Date(base.getTime() - (10 - i) * 3600000).toISOString(),
    };
    if (
      (d.status === "scheduled" || d.status === "running" || d.status === "done") &&
      d.startOffsetH !== undefined &&
      d.machineId
    ) {
      b.slot = {
        machineId: d.machineId,
        startAt: isoAt(base, d.startOffsetH),
        endAt: isoAt(base, d.startOffsetH, d.durationMin),
      };
    }
    if (d.status === "review" && d.startOffsetH !== undefined && d.machineId) {
      b.previousSlot = {
        machineId: d.machineId,
        startAt: isoAt(base, d.startOffsetH),
        endAt: isoAt(base, d.startOffsetH, d.durationMin),
        reason: d.reviewReason ?? "工艺变更待确认",
      };
    }
    return b;
  });

  return {
    machines: seedMachines(),
    batches,
    rules: { ...DEFAULT_RULES },
  };
}

export function seedLogs(base: Date = new Date()): LogEntry[] {
  const d = new Date(base.getTime() - base.getTimezoneOffset() * 60000);
  const stamp = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(
    d.getDate()
  )}`;
  return [
    {
      id: "L-0001",
      ts: new Date(Date.now() - 6 * 3600000).toISOString(),
      type: "start",
      batchId: "DYE-2401",
      message: "DYE-2401 已开染，排期锁定",
    },
    {
      id: "L-0002",
      ts: new Date(Date.now() - 20 * 3600000).toISOString(),
      type: "process-change",
      batchId: "DYE-2405",
      message:
        "DYE-2405 工艺变更，退回待确认并保留旧排期：后整理「柔软整理 2%」→「液氨丝光」",
    },
    {
      id: "L-0003",
      ts: `${stamp}T01:00:00.000Z`,
      type: "rules-change",
      message: "排程规则初始化：缓冲 30 分；工作时段 07:00–22:00",
    },
  ];
}
