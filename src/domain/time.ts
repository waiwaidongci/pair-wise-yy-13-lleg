// 时间工具：统一走本地时间字符串与 ISO 互转，避免 UTC 偏移

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Date -> datetime-local input 字符串 */
export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(
    d.getDate()
  )}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** datetime-local 字符串 -> Date（按本地时区） */
export function fromLocalInput(s: string): Date {
  const [date, time = "00:00"] = s.split("T");
  const [y, m, dd] = date.split("-").map(Number);
  const [hh = 0, mm = 0] = time.split(":").map(Number);
  return new Date(y, (m || 1) - 1, dd || 1, hh, mm, 0, 0);
}

export function isoFromLocal(s: string): string | null {
  if (!s) return null;
  const d = fromLocalInput(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(
    d.getMinutes()
  )}`;
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function fmtDuration(min: number): string {
  if (min <= 0) return "0分";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}小时${m ? m + "分" : ""}` : `${m}分`;
}

export function addMin(iso: string, min: number): string {
  return new Date(new Date(iso).getTime() + min * 60000).toISOString();
}

export function diffMin(a: string, b: string): number {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 60000);
}

/** 把时刻向下取整到 step（分钟） */
export function floorStep(d: Date, stepMin: number): Date {
  const r = new Date(d);
  const m = r.getHours() * 60 + r.getMinutes();
  const f = Math.floor(m / stepMin) * stepMin;
  r.setHours(0, 0, 0, 0);
  return new Date(r.getTime() + f * 60000);
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function dayStart(iso: string): Date {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d;
}
