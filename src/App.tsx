import { useState } from 'react';
import {
  ReservationProvider,
  useReservation,
} from './state/ReservationContext';
import { SchedulePage } from './pages/SchedulePage';
import { BatchesPage } from './pages/BatchesPage';
import { GapsPage } from './pages/GapsPage';
import { HistoryPage } from './pages/HistoryPage';
import { RulesPage } from './pages/RulesPage';
import { BatchFormModal } from './components/BatchFormModal';
import { BatchDetailModal } from './components/BatchDetailModal';
import { PlaceModal } from './components/PlaceModal';
import type { Batch } from './domain/types';

type Tab = 'board' | 'gaps' | 'batches' | 'history' | 'rules';

const TABS: { key: Tab; label: string }[] = [
  { key: 'board', label: '排程看板' },
  { key: 'gaps', label: '染缸空档' },
  { key: 'batches', label: '批次档案' },
  { key: 'history', label: '调整历史' },
  { key: 'rules', label: '排程规则' },
];

function Shell() {
  const { notice, dispatch, operator, setOperator, batches } = useReservation();
  const [tab, setTab] = useState<Tab>('board');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Batch | null>(null);
  const [detail, setDetail] = useState<Batch | null>(null);
  const [placing, setPlacing] = useState<Batch | null>(null);

  // 详情/占位对象始终取最新档案（排期变化后弹窗同步）
  const liveDetail = detail ? batches.find((b) => b.id === detail.id) ?? null : null;
  const livePlacing = placing ? batches.find((b) => b.id === placing.id) ?? null : null;

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (b: Batch) => {
    setDetail(null);
    setEditing(b);
    setFormOpen(true);
  };
  const openBatchById = (id: string) => {
    const b = batches.find((x) => x.id === id);
    if (b) setDetail(b);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">染</span>
          <div>
            <h1>染缸预约台</h1>
            <small>打样排期 · 占位冲突自动校验 · 加急提前 · 变更留痕</small>
          </div>
        </div>
        <div className="header-right">
          <label className="operator">
            当前操作人
            <input value={operator} onChange={(e) => setOperator(e.target.value)} />
          </label>
          <button
            className="ghost"
            onClick={() => {
              if (confirm('恢复为内置演示数据？当前修改将被覆盖。')) dispatch({ type: 'resetDemo' });
            }}
          >
            重置演示
          </button>
        </div>
      </header>

      <nav className="app-nav">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'nav-btn on' : 'nav-btn'} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main className="app-main">
        {tab === 'board' && <SchedulePage onOpenBatch={(b) => setDetail(b)} />}
        {tab === 'batches' && <BatchesPage onOpenBatch={(b) => setDetail(b)} onNew={openNew} />}
        {tab === 'gaps' && <GapsPage />}
        {tab === 'history' && <HistoryPage onOpenBatch={openBatchById} />}
        {tab === 'rules' && <RulesPage />}
      </main>

      <footer className="app-foot">
        排程规则（纯函数引擎）· 批次档案（localStorage）· 页面（React）三层各自维护，互不耦合
      </footer>

      {formOpen && <BatchFormModal open={formOpen} editing={editing} onClose={() => setFormOpen(false)} />}
      {liveDetail && !formOpen && (
        <BatchDetailModal
          batch={liveDetail}
          onClose={() => setDetail(null)}
          onEdit={openEdit}
          onPlace={(b) => {
            setDetail(null);
            setPlacing(b);
          }}
        />
      )}
      {livePlacing && <PlaceModal batch={livePlacing} onClose={() => setPlacing(null)} />}

      {notice && (
        <div className={`toast toast-${notice.level}`} onClick={() => dispatch({ type: 'clearNotice' })}>
          {notice.text}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ReservationProvider>
      <Shell />
    </ReservationProvider>
  );
}
