import { build } from 'esbuild';
import { writeFileSync } from 'fs';

const res = await build({
  entryPoints: ['/workspace/src/domain/engine.ts'],
  bundle: true, format: 'esm', write: false, platform: 'node',
});
writeFileSync('/tmp/eng-bundle.mjs', res.outputFiles[0].text);
const eng = await import('file:///tmp/eng-bundle.mjs');

let pass = 0, fail = 0;
function ok(name, cond, extra='') {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra); }
}

// 构造最小状态
const now = new Date(2026, 8, 25, 8, 0); // 2026-09-25 08:00 本地
const iso = (h, m=0, day=25) => new Date(2026, 8, day, h, m).toISOString();
const rules = { bufferMin: 30, horizonDays: 7, slotStepMin: 15, workStartMin: 420, workEndMin: 1320, warnBeforeDueHours: 12 };
const machines = [{id:'M1',name:'1#',enabled:true,note:''},{id:'M2',name:'2#',enabled:true,note:''},{id:'M3',name:'3#',enabled:false,note:''}];
let nid=0;
function batch(over={}) {
  nid++;
  return {
    id:'B'+nid, orderNo:'O'+nid, customer:'C', fabric:'棉',
    colorTarget: 1.0,
    process:{ recipeNo:'R'+nid, recipeReviewed:true, durationMin:300, holdMin:30, finish:'' },
    dueAt: iso(20, 0, 27), rush:false, note:'',
    status:'pending', slot:null, previousSlot:null,
    ...over, createdAt: now.toISOString(),
  };
}
const st = (batches) => ({ machines: structuredClone(machines), batches, rules: {...rules} });

// 1) 资料不齐 → 待排原因
{
  const b1 = batch({ colorTarget: null });
  const b2 = batch({ process:{ recipeNo:'R', recipeReviewed:false, durationMin:300, holdMin:30, finish:'' }});
  ok('色差未定不可排', eng.readiness(b1).reasons.includes('色差目标未定'));
  ok('配方未复核不可排', eng.readiness(b2).reasons.includes('配方未复核'));
}

// 2) 最早空档：M1 有 09:00–14:30(含缓冲) 的块，新批 300 分应排在 14:30
{
  const occ = batch({ status:'scheduled', slot:{ machineId:'M1', startAt: iso(9), endAt: iso(14) } });
  const cand = batch();
  const slot = eng.earliestSlot(st([occ, cand]), cand, { fromIso: now.toISOString(), machineIds:['M1'] });
  ok('避开占用块+缓冲', new Date(slot.startAt).getHours()===14 && new Date(slot.startAt).getMinutes()===30, JSON.stringify(slot));
  ok('限定染缸时落在 M1', slot.machineId==='M1', slot.machineId);
}

// 3) 手动占位冲突报错
{
  const occ = batch({ id:'B0', status:'scheduled', slot:{ machineId:'M1', startAt: iso(9), endAt: iso(14) } });
  const cand = batch();
  let threw='';
  try { eng.manualBook(st([occ,cand]), cand.id, 'M1', iso(13,45), now.toISOString()); } catch(e){ threw=e.message; }
  ok('重叠占位被拦截', threw.includes('重叠'), threw);
  let ok2='';
  try { const r = eng.manualBook(st([occ,cand]), cand.id, 'M1', iso(14,30), now.toISOString()); ok2=r; } catch(e){ ok2=e.message; }
  ok('缓冲后可占位', ok2.state, String(ok2));
  let past='';
  try { eng.manualBook(st([cand]), cand.id, 'M1', iso(7), now.toISOString()); } catch(e){ past=e.message; }
  ok('过去时刻被拦截', past.includes('过去'), past);
}

// 4) 自动排程：齐的排上，不齐的留待排
{
  const ready = batch();
  const notReady = batch({ colorTarget: null });
  const r = eng.autoSchedule(st([ready, notReady]), now.toISOString());
  ok('自动排程排上就绪批', r.state.batches.find(b=>b.id===ready.id).status==='scheduled');
  ok('不齐批次留待排', r.state.batches.find(b=>b.id===notReady.id).status==='pending');
}

// 5) 开染后不可改
{
  const run = batch({ status:'running', slot:{ machineId:'M1', startAt: iso(7), endAt: iso(12) } });
  let threw='';
  try { eng.changeProcess(st([run]), run.id, { holdMin: 50 }); } catch(e){ threw=e.message; }
  ok('开染中禁止工艺变更', threw.includes('已开染'), threw);
  const r = eng.startDye(st([batch({status:'scheduled', slot:{machineId:'M1',startAt:iso(8),endAt:iso(13)}})]), 'B'+nid);
}

// 6) 工艺变更 → 已排批次退 review 且保留旧排期与原因
{
  const old = { machineId:'M1', startAt: iso(16), endAt: iso(21) };
  const b = batch({ status:'scheduled', slot: {...old} });
  const r = eng.changeProcess(st([b]), b.id, { finish: '液氨丝光' });
  const nb = r.state.batches.find(x=>x.id===b.id);
  ok('工艺变更退待确认', nb.status==='review');
  ok('保留旧排期', nb.previousSlot && nb.previousSlot.startAt===old.startAt);
  ok('记录原因', nb.previousSlot.reason.includes('液氨丝光'), nb.previousSlot.reason);
  ok('当前 slot 清空', nb.slot===null);
}

// 7) 保留旧排期时若冲突则报错；释放回 pending
{
  const old = { machineId:'M1', startAt: iso(16), endAt: iso(21) };
  const b = batch({ status:'review', previousSlot:{ ...old, reason:'x' } });
  const blocker = batch({ status:'scheduled', slot:{ machineId:'M1', startAt: iso(15,30), endAt: iso(20,30) } });
  let threw='';
  try { eng.resolveReview(st([b, blocker]), b.id, 'keep', now.toISOString()); } catch(e){ threw=e.message; }
  ok('旧排期冲突不能保留', threw.includes('重叠'), threw);
  const r = eng.resolveReview(st([b]), b.id, 'release', now.toISOString());
  const nb = r.state.batches.find(x=>x.id===b.id);
  ok('释放后待排且旧排期清空', nb.status==='pending' && nb.previousSlot===null);
}

// 8) 加急插单：running 不动，scheduled 被后移
{
  const run = batch({ id:'RUN', status:'running', slot:{ machineId:'M1', startAt: iso(8), endAt: iso(12) } });
  const occ = batch({ id:'OCC', status:'scheduled', slot:{ machineId:'M1', startAt: iso(12,30), endAt: iso(16) } });
  const rush = batch({ id:'RUSH', rush:true, process:{recipeNo:'R',recipeReviewed:true,durationMin:180,holdMin:20,finish:''} });
  const onlyM1 = { machines: machines.filter(m=>m.id==='M1').map(m=>structuredClone(m)), batches:[], rules:{...rules} };
  const state0 = ((x)=>({machines:x.machines,batches:[run,occ,rush],rules:x.rules}))(onlyM1);
  const r = eng.rushInsert(state0, 'RUSH', now.toISOString());
  const rb = r.state.batches.find(b=>b.id==='RUSH');
  const ob = r.state.batches.find(b=>b.id==='OCC');
  const runb = r.state.batches.find(b=>b.id==='RUN');
  ok('加急排入', rb.status==='scheduled' && new Date(rb.slot.startAt).getTime() >= now.getTime());
  ok('开染块不动', runb.slot.startAt===run.slot.startAt && runb.status==='running');
  ok('被挤批次不与加急重叠(running也不重叠)', (() => {
    const collide = (a,b2)=> a.slot.machineId===b2.slot.machineId && new Date(a.slot.startAt) < new Date(b2.slot.endAt).getTime()+30*60000 && new Date(a.slot.endAt).getTime()+30*60000 > new Date(b2.slot.startAt).getTime();
    return !collide(rb, ob) && !collide(rb, runb) && !collide(ob, runb);
  })());
  ok('插单有移位事件', r.events.some(e=>e.type==='rush-shift'));
}

// 9) 加急插单不得跨越 running 把已排块挤到 running 前面/重叠 — 由上面 collide 覆盖
// 10) 规则变更（缩小窗口）→ 冲突已排批退 review，running 不动
{
  const s1 = batch({ status:'scheduled', slot:{ machineId:'M1', startAt: iso(9), endAt: iso(14) } });
  const run = batch({ status:'running', slot:{ machineId:'M2', startAt: iso(7), endAt: iso(11) } });
  const state0 = st([s1, run]);
  const narrow = { ...rules, workStartMin: 600, workEndMin: 660 }; // 10:00–11:00
  const r = eng.updateRules(state0, narrow, now.toISOString());
  ok('规则变更后冲突批退review', r.state.batches.find(b=>b.id===s1.id).status==='review');
  ok('开染中不复核', r.state.batches.find(b=>b.id===run.id).status==='running');
}

// 11) 空档视图
{
  const occ = batch({ status:'scheduled', slot:{ machineId:'M1', startAt: iso(9), endAt: iso(12) } });
  const gaps = eng.gapsOfDay(st([occ]), now.toISOString());
  ok('空档至少两段', gaps.filter(g=>g.machineId==='M1').length>=2, JSON.stringify(gaps.map(g=>[g.machineId,g.fitMin])));
}

// 12) 交期风险：完工晚于交期 danger
{
  const late = batch({ status:'scheduled', slot:{ machineId:'M1', startAt: iso(18,0,26), endAt: iso(23,0,26) }, dueAt: iso(12,0,26) });
  const r = eng.risks(st([late]), now.toISOString());
  ok('晚于交期=危险', r.some(x=>x.batchId===late.id && x.level==='danger'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
