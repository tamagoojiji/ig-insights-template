/* global React */
const { useState, useEffect, useRef, useMemo, useCallback } = React;

// --- Icon helpers ---
const Icon = {
  Sun: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
    </svg>
  ),
  Moon: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  ),
  Copy: () => (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  ),
  Check: () => (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  Chev: () => (
    <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  ),
  Arrow: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
    </svg>
  ),
  Menu: () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="7" x2="20" y2="7"/>
      <line x1="4" y1="12" x2="20" y2="12"/>
      <line x1="4" y1="17" x2="20" y2="17"/>
    </svg>
  ),
  Close: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="6" x2="18" y2="18"/>
      <line x1="6" y1="18" x2="18" y2="6"/>
    </svg>
  ),
};

// --- Copyable inline value ---
function Copyable({ children, value }) {
  const [copied, setCopied] = useState(false);
  const text = value ?? (typeof children === "string" ? children : "");
  const onClick = (e) => {
    e.preventDefault();
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <button type="button" className={"copyable" + (copied ? " copied" : "")} onClick={onClick} title="クリックでコピー">
      <span>{children}</span>
      {copied ? <Icon.Check/> : <Icon.Copy/>}
    </button>
  );
}

// --- Code block with copy ---
function CodeBlock({ label = "Code", children }) {
  const [copied, setCopied] = useState(false);
  const text = String(children).replace(/^\n+|\n+$/g, "");
  const onCopy = () => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <div className="codeblock">
      <div className="codeblock-header">
        <span>{label}</span>
        <button className={"codeblock-copy" + (copied ? " copied" : "")} onClick={onCopy}>
          {copied ? "コピー済み" : "コピー"}
        </button>
      </div>
      <pre>{text}</pre>
    </div>
  );
}

// --- Callouts ---
function Callout({ kind = "info", icon, children }) {
  const defaultIcon = { info: "💡", success: "✅", warn: "⚠️", danger: "🚫" }[kind];
  return (
    <aside className={"callout callout-" + kind}>
      <span className="ico" aria-hidden>{icon ?? defaultIcon}</span>
      <div>{children}</div>
    </aside>
  );
}

// --- Pitfall (always open) ---
function Pitfall({ title = "つまずきポイント", children }) {
  return (
    <div className="pitfall open">
      <div className="pitfall-header pitfall-header-static">
        <span className="ico">⚠️</span>
        <span className="label">{title}</span>
      </div>
      <div className="pitfall-body">{children}</div>
    </div>
  );
}

// --- Step section wrapper ---
function StepSection({ id, num, kicker = "STEP", title, subtitle, done, onToggleDone, children, completeLabel }) {
  return (
    <section id={id} className={"step" + (done ? " done" : "")} data-step-id={id}>
      <header className="step-header">
        <div className="step-badge">
          <span>{kicker}</span>
          <span className="num">{num}</span>
        </div>
        <div className="step-title-wrap">
          <h2>{title}</h2>
          {subtitle && <p className="step-subtitle">{subtitle}</p>}
        </div>
      </header>
      <div className="body">{children}</div>
      {onToggleDone && (
        <div className="step-complete">
          <div className="step-complete-text">
            <strong>{done ? "このステップは完了済みです" : (completeLabel || "ここまで終わったらチェック")}</strong>
            {!done && <span>進捗バーが進みます。あとで戻ってきても大丈夫です。</span>}
            {done && <span>クリックすると未完了に戻せます。</span>}
          </div>
          <button className="complete-btn" onClick={onToggleDone}>
            <span className="check"><Icon.Check/></span>
            {done ? "完了済み" : "完了にする"}
          </button>
        </div>
      )}
    </section>
  );
}

// --- Plain section ---
function Section({ id, title, children }) {
  return (
    <section id={id} className="section">
      <h2>{title}</h2>
      <div className="body">{children}</div>
    </section>
  );
}

// --- Login check card ---
function LoginCard({ href, badge, badgeBg, title, sub }) {
  const inner = (
    <>
      <span className="lc-badge" style={{ background: badgeBg }}>{badge}</span>
      <span className="lc-text">
        <span className="lc-title">{title}</span>
        <span className="lc-sub">{sub}</span>
      </span>
      {href && <span className="lc-arrow" aria-hidden>↗</span>}
    </>
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="login-card">
        {inner}
      </a>
    );
  }
  return <div className="login-card login-card-static">{inner}</div>;
}

function LoginCheckGrid({ cards }) {
  return (
    <div className="login-grid">
      {cards.map((c, i) => <LoginCard key={i} {...c} />)}
    </div>
  );
}

// --- Step image (with placeholder when src missing) ---
function StepImage({ src, alt, caption, slot }) {
  if (!src) {
    return (
      <figure className="step-image step-image-placeholder">
        <div className="placeholder-box">
          <span className="ph-icon">📷</span>
          <span className="ph-slot">{slot || "画像"}</span>
          {alt && <span className="ph-alt">{alt}</span>}
        </div>
        {caption && <figcaption>{caption}</figcaption>}
      </figure>
    );
  }
  return (
    <figure className="step-image">
      <img src={src} alt={alt || ""} loading="lazy" />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

// --- FAQ item ---
function FaqItem({ q, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={"faq-item" + (open ? " open" : "")}>
      <button className="faq-q" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="q-mark">Q</span>
        <span className="label">{q}</span>
        <Icon.Chev/>
      </button>
      <div className="faq-a">{children}</div>
    </div>
  );
}

Object.assign(window, { Copyable, CodeBlock, Callout, Pitfall, StepSection, Section, FaqItem, Icon, LoginCard, LoginCheckGrid, StepImage });
