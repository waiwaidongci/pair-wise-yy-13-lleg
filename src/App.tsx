import { useMemo, useState } from "react";
import { StoreProvider, useStore } from "./store/store";
import BoardPage from "./ui/BoardPage";
import BatchesPage from "./ui/BatchesPage";
import GapsPage from "./ui/GapsPage";
import RisksPage from "./ui/RisksPage";
import RulesPage from "./ui/RulesPage";
import HistoryPage from "./ui/HistoryPage";
import { risks } from "./domain/engine";

type Tab = "board" | "batches" | "gaps" | "risks" | "rules" | "history";

const TABS: { id: Tab; label: string }[] = [
  { id: "board", label: "预约白板" },
  { id: "batches", label: "批次档案" },
  { id: "gaps", label: "空档" },
  { id: "risks", label: "交期风险" },
  { id: "rules", label: "排程规则" },
  { id: "history", label: "调整历史" },
];

function Shell() {
  const store = useStore();
  const [tab, setTab] = useState<Tab>("board");

  const counts = useMemo(() => {
    const c = { pending: 0, review: 0, riskDanger: 0 };
    for (const b of store.state.batches) {
      if (b.status === "pending") c.pending += 1;
      if (b.status === "review") c.review += 1;
    }
    c.riskDanger = risks(store.state, store.now.toISOString()).filter(
      (r) => r.level === "danger"
    ).length;
    return c;
  }, [store.state, store.now]);

  const badge = (id: Tab): number | null => {
    if (id === "batches") return counts.pending || null;
    if (id === "board") return counts.review || null;
    if (id === "risks") return counts.riskDanger || null;
    return null;
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">染</span>
          <div>
            <h1>打样染缸预约台</h1>
            <small>排期不再靠白板 · 按染缸占位 · 冲突自动拦截</small>
          </div>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? "tab-on" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {badge(t.id) && <span className="tab-badge">{badge(t.id)}</span>}
            </button>
          ))}
        </nav>
      </header>
      <main className="content">
        {tab === "board" && <BoardPage />}
        {tab === "batches" && <BatchesPage />}
        {tab === "gaps" && <GapsPage />}
        {tab === "risks" && <RisksPage />}
        {tab === "rules" && <RulesPage />}
        {tab === "history" && <HistoryPage />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
