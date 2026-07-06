/* global React, ReactDOM, useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakSelect, TweakToggle */
const { useState, useEffect, useRef, useCallback } = React;

// TOC structure
const TOC = [
  { kind: "section", label: "はじめに" },
  { id: "step-0", num: "00", title: "進め方・必要なもの" },
  { kind: "section", label: "セットアップ" },
  { id: "step-1", num: "01", title: "マスタースプシをコピー" },
  { id: "step-2", num: "02", title: "Meta Developer 登録" },
  { id: "step-3", num: "03", title: "権限追加" },
  { id: "step-4", num: "04", title: "APP_ID / APP_SECRET" },
  { id: "step-5", num: "05", title: "短期アクセストークン" },
  { id: "step-6", num: "06", title: "接続テスト・自動長期化" },
  { id: "step-7", num: "07", title: "IG_USER_ID 確認" },
  { id: "step-8", num: "08", title: "Drive 画像保存フォルダ" },
  { id: "step-9", num: "09", title: "Gemini API キー（任意）" },
  { id: "step-10", num: "10", title: "Discord Webhook（任意）" },
  { id: "step-11", num: "11", title: "トリガー設置" },
  { kind: "section", label: "運用とリファレンス" },
  { id: "daily-ops", title: "日々の運用" },
  { id: "compliance", title: "規約・データの扱い" },
  { id: "faq", title: "FAQ" },
  { id: "aftercare", title: "アフターフォロー" },
];

const STEP_IDS = TOC.filter(t => t.id && t.id.startsWith("step-")).map(t => t.id);

const STORAGE_KEY = "ig-insights-guide-v1";
const THEME_KEY = "ig-insights-theme-v1";

function loadState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}
function saveState(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

function App() {
  const [done, setDone] = useState(() => loadState().done || {});
  const [theme, setTheme] = useState(() => {
    const v = localStorage.getItem(THEME_KEY);
    if (v) return v;
    return matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [activeId, setActiveId] = useState("step-0");
  const [scrollPct, setScrollPct] = useState(0);
  const [tocOpen, setTocOpen] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") setTocOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.body.style.overflow = tocOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [tocOpen]);

  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "mood": "kinako",
    "type": "gothic",
    "weight": "bold",
    "density": "loose"
  }/*EDITMODE-END*/;
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  useEffect(() => {
    const r = document.documentElement;
    r.setAttribute("data-mood", t.mood);
    r.setAttribute("data-type", t.type);
    r.setAttribute("data-weight", t.weight);
    r.setAttribute("data-density", t.density);
  }, [t.mood, t.type, t.weight, t.density]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    saveState({ done });
  }, [done]);

  const toggleDone = useCallback((id) => {
    setDone(d => ({ ...d, [id]: !d[id] }));
  }, []);

  const resetDone = () => {
    if (confirm("進捗チェックをすべてリセットしますか？")) setDone({});
  };

  // Scroll spy via IntersectionObserver
  useEffect(() => {
    const ids = TOC.filter(t => t.id).map(t => t.id);
    const els = ids.map(id => document.getElementById(id)).filter(Boolean);
    if (!els.length) return;
    let visible = new Map();
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) visible.set(e.target.id, e.intersectionRatio);
        else visible.delete(e.target.id);
      });
      let bestId = null, bestY = Infinity;
      els.forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.top <= 140 && r.top > -r.height) {
          if (r.top > -r.height + 20 && Math.abs(r.top - 100) < bestY) {
            bestY = Math.abs(r.top - 100);
            bestId = el.id;
          }
        }
      });
      if (bestId) setActiveId(bestId);
      else if (visible.size) {
        const top = [...visible.entries()].sort((a,b)=>b[1]-a[1])[0][0];
        setActiveId(top);
      }
    }, { rootMargin: "-100px 0px -60% 0px", threshold: [0, 0.1, 0.5, 1] });
    els.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  // Scroll progress
  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      const pct = max > 0 ? (h.scrollTop / max) * 100 : 0;
      setScrollPct(pct);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const stepCount = STEP_IDS.length;
  const doneCount = STEP_IDS.filter(id => done[id]).length;
  const stepPct = stepCount ? Math.round((doneCount / stepCount) * 100) : 0;

  const goTo = (id) => {
    const el = document.getElementById(id);
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - 84;
      window.scrollTo({ top, behavior: "smooth" });
    }
    setTocOpen(false);
  };

  return (
    <>
      <div className="topbar">
        <div className="topbar-row">
          <button className="hamburger" onClick={() => setTocOpen(true)}
            aria-label="目次を開く" title="目次">
            <Icon.Menu/>
          </button>
          <div className="topbar-brand">
            <span className="brand-mark">📊</span>
            <span>IG Insights セットアップ手順書</span>
          </div>
          <div className="topbar-spacer"/>
          <div className="progress-pill" title={`${doneCount} / ${stepCount} ステップ完了`}>
            <span className="ring" style={{ "--p": stepPct }}/>
            <span><span className="num">{doneCount}</span> / {stepCount} steps</span>
          </div>
          <button className="theme-toggle" onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
            aria-label="テーマ切替" title="ダーク／ライト切替">
            {theme === "dark" ? <Icon.Sun/> : <Icon.Moon/>}
          </button>
        </div>
        <div className="progress-bar-track">
          <div className="progress-bar-fill" style={{ transform: `scaleX(${scrollPct/100})` }}/>
        </div>
      </div>

      <div className="layout layout-wide">
        {tocOpen && <div className="toc-backdrop" onClick={() => setTocOpen(false)} aria-hidden/>}
        <aside className={"toc toc-drawer" + (tocOpen ? " open" : "")} aria-label="目次" aria-hidden={!tocOpen}>
          <div className="toc-drawer-header">
            <p className="toc-title">SETUP STEPS</p>
            <button className="toc-close" onClick={() => setTocOpen(false)} aria-label="目次を閉じる">
              <Icon.Close/>
            </button>
          </div>
          <ul className="toc-list">
            {TOC.map((item, i) => {
              if (item.kind === "section") {
                return <li key={"sec-" + i} className="toc-section-label">{item.label}</li>;
              }
              const isStep = item.id && item.id.startsWith("step-");
              const isDone = isStep && !!done[item.id];
              const isActive = activeId === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={"toc-item" + (isActive ? " active" : "") + (isDone ? " done" : "")}
                    onClick={() => goTo(item.id)}
                  >
                    {item.num && <span className="toc-num">{item.num}</span>}
                    <span className="toc-label">{item.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button type="button" className="reset-link" onClick={resetDone}>
            進捗チェックをリセット
          </button>
        </aside>
        <main>
          <section className="hero">
            <span className="hero-eyebrow">SETUP GUIDE · v1.0</span>
            <h1>Instagram の全インサイトを、自分のスプシに永続保存する</h1>
            <p className="hero-sub">
              Meta 公式 Graph API で投稿のリーチ・閲覧数・反応数を自動取得し、画像実体は自分の Drive にコピー保存。
              Step 1 から順番に進めれば 60〜120 分で完成します。
            </p>
            <div className="hero-meta">
              <span className="meta-chip">⏱ <strong>所要 60〜120 分</strong></span>
              <span className="meta-chip">📋 <strong>12 ステップ</strong>（うち 2 つは任意）</span>
              <span className="meta-chip">💴 <strong>運用コスト ほぼ ¥0</strong></span>
              <span className="meta-chip">🔒 <strong>BYO 型</strong>（トークンは自分で管理）</span>
            </div>
            <div className="hero-cta">
              <button className="btn-primary" onClick={() => goTo("step-1")}>
                Step 1 から始める <Icon.Arrow/>
              </button>
              <button className="btn-ghost" onClick={() => goTo("faq")}>FAQ を見る</button>
            </div>
            <p className="lights-hint">進捗チェックとテーマ設定はこのブラウザに保存され、再訪問しても残ります。</p>
          </section>

          <Step0 done={!!done["step-0"]} onToggle={() => toggleDone("step-0")} />
          <Step1 done={!!done["step-1"]} onToggle={() => toggleDone("step-1")} />
          <Step2 done={!!done["step-2"]} onToggle={() => toggleDone("step-2")} />
          <Step3 done={!!done["step-3"]} onToggle={() => toggleDone("step-3")} />
          <Step4 done={!!done["step-4"]} onToggle={() => toggleDone("step-4")} />
          <Step5 done={!!done["step-5"]} onToggle={() => toggleDone("step-5")} />
          <Step6 done={!!done["step-6"]} onToggle={() => toggleDone("step-6")} />
          <Step7 done={!!done["step-7"]} onToggle={() => toggleDone("step-7")} />
          <Step8 done={!!done["step-8"]} onToggle={() => toggleDone("step-8")} />
          <Step9 done={!!done["step-9"]} onToggle={() => toggleDone("step-9")} />
          <Step10 done={!!done["step-10"]} onToggle={() => toggleDone("step-10")} />
          <Step11 done={!!done["step-11"]} onToggle={() => toggleDone("step-11")} />

          <div className="divider"/>

          <DailyOps/>
          <Compliance/>
          <Faq/>
          <AfterCare/>

          <footer className="footer">
            <div>© 2026 BridgeSquare / @tamago_app</div>
            <div style={{ display: "flex", gap: 16 }}>
              <a href="https://tamagoojiji.github.io/bridgesquare-legal/privacy-policy.html" target="_blank" rel="noreferrer">プライバシーポリシー</a>
              <a href="https://tamagoojiji.github.io/bridgesquare-legal/terms-of-service.html" target="_blank" rel="noreferrer">利用規約</a>
            </div>
          </footer>
        </main>
      </div>

      <TweaksPanel title="読み心地のチューニング">
        <TweakSection label="読書ムード" />
        <TweakRadio
          label="雰囲気"
          value={t.mood}
          options={[
            { value: "kinako", label: "きなこ" },
            { value: "aizome", label: "藍染" },
            { value: "note", label: "ノート" },
          ]}
          onChange={(v) => setTweak("mood", v)}
        />
        <TweakSection label="文字" />
        <TweakRadio
          label="書体"
          value={t.type}
          options={[
            { value: "maru", label: "丸ゴ" },
            { value: "mincho", label: "明朝" },
            { value: "gothic", label: "角ゴ" },
          ]}
          onChange={(v) => setTweak("type", v)}
        />
        <TweakRadio
          label="太さ"
          value={t.weight}
          options={[
            { value: "normal", label: "標準" },
            { value: "bold", label: "太め" },
          ]}
          onChange={(v) => setTweak("weight", v)}
        />
        <TweakSection label="レイアウト" />
        <TweakRadio
          label="密度"
          value={t.density}
          options={[
            { value: "loose", label: "ゆったり" },
            { value: "normal", label: "ふつう" },
            { value: "dense", label: "凝縮" },
          ]}
          onChange={(v) => setTweak("density", v)}
        />
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
