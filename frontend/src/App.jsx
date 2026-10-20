import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Code2,
  Gauge,
  Globe2,
  LockKeyhole,
  Menu,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Zap,
} from "lucide-react";
import { api } from "./api";

const products = [
  { id: 1, name: "Studio Headphones", category: "Audio", price: 189, color: "#eee9df", art: "headphones", tag: "BESTSELLER", rating: "4.9", glyph: "◖◗" },
  { id: 2, name: "Everyday Carry Pack", category: "Accessories", price: 128, color: "#e8eddf", art: "bag", tag: "NEW ARRIVAL", rating: "4.8", glyph: "◒" },
  { id: 3, name: "Analog Desk Clock", category: "Home", price: 84, color: "#efe6e2", art: "clock", tag: "", rating: "4.7", glyph: "◷" },
  { id: 4, name: "Minimal Ceramic Set", category: "Home", price: 56, color: "#e4e9ee", art: "ceramic", tag: "LOW STOCK", rating: "4.9", glyph: "♧" },
];
const blankPolicy = { client_id: "storefront", capacity: 5, refill_rate: 1 / 360, enabled: true };

function secondsPerToken(refillRate) {
  return Number((1 / Number(refillRate)).toPrecision(6));
}

function formatNumber(value = 0) {
  return Number(value || 0).toLocaleString();
}

function StatCard({ title, value, note, tone, icon: Icon, trend, context = "Last 24 hours" }) {
  return (
    <article className={`stat-card ${tone === "tone-red" ? "stat-card-rejected" : ""}`}>
      <div className="stat-top">
        <span>{title}</span>
        <span className={`stat-icon ${tone}`}><Icon size={17} strokeWidth={1.8} /></span>
      </div>
      <div className="stat-value">{formatNumber(value)}</div>
      <div className="stat-note">
        <span className={`trend ${trend === "down" ? "trend-down" : ""}`}>
          {trend === "down" ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
          {note}
        </span>
        <span>{context}</span>
      </div>
    </article>
  );
}

function ActivityChart({ traffic = [] }) {
  const maximum = Math.max(...traffic.flatMap((point) => [point.allowed, point.rejected]), 1);
  const line = (key) => traffic.map((item, index) => {
    const x = 12 + (index / Math.max(traffic.length - 1, 1)) * 576;
    const y = 140 - Math.min(item[key] / maximum, 1) * 112;
    return `${index ? "L" : "M"} ${x} ${y}`;
  }).join(" ");
  const allowedLine = line("allowed");
  const rejectedLine = line("rejected");
  const lastX = 12 + ((traffic.length - 1) / Math.max(traffic.length - 1, 1)) * 576;
  const lastAllowedY = 140 - Math.min((traffic.at(-1)?.allowed || 0) / maximum, 1) * 112;
  const lastRejectedY = 140 - Math.min((traffic.at(-1)?.rejected || 0) / maximum, 1) * 112;
  return (
    <svg className="traffic-chart" viewBox="0 0 600 166" preserveAspectRatio="none" role="img" aria-label="Allowed and rejected requests in the last 24 hours">
      {[38, 76, 114, 152].map((y) => <line key={y} x1="0" y1={y} x2="600" y2={y} className="chart-grid" />)}
      {traffic.length > 0 && <><path d={allowedLine} className="chart-line" /><path d={rejectedLine} className="chart-line chart-line-rejected" /><circle cx={lastX} cy={lastAllowedY} r="4" className="chart-dot" /><circle cx={lastX} cy={lastRejectedY} r="4" className="chart-dot chart-dot-rejected" /></>}
    </svg>
  );
}

function TokenBucket({ policy }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 150);
    return () => window.clearInterval(timer);
  }, []);
  const capacity = policy.capacity;
  const elapsed = Math.max(0, now / 1000 - policy.last_refill);
  const tokens = policy.enabled
    ? Math.min(capacity, policy.tokens + elapsed * policy.refill_rate)
    : policy.tokens;
  const slotCount = Math.min(capacity, 12);
  const tokenPerSlot = capacity / slotCount;
  const nextTokenIn = tokens >= capacity ? null : (1 - (tokens % 1)) / policy.refill_rate;
  return (
    <div className="bucket-visualization">
      <div className="bucket-count"><strong>{tokens.toFixed(tokens % 1 > 0.05 ? 1 : 0)}</strong><span>/ {capacity} tokens</span></div>
      <div className="token-cups" role="img" aria-label={`${tokens.toFixed(1)} of ${capacity} tokens available`}>
        {Array.from({ length: slotCount }, (_, index) => {
          const fill = Math.max(0, Math.min(100, ((tokens - index * tokenPerSlot) / tokenPerSlot) * 100));
          return <div className="token-slot" key={index} title={`Token ${index + 1}`}><div className="token-cup"><div className="token-cup-fill" style={{ height: `${fill}%` }} /></div><span>{index + 1}</span></div>;
        })}
      </div>
      <div className="bucket-time">{!policy.enabled ? "Policy paused · requests pass through" : nextTokenIn === null ? "Bucket full · ready for a burst" : `Next token in ${nextTokenIn < 10 ? nextTokenIn.toFixed(1) : `${Math.ceil(nextTokenIn)} sec`}`}</div>
      {capacity > 12 && <div className="bucket-scale">Each cup represents about {Math.ceil(tokenPerSlot)} tokens</div>}
    </div>
  );
}

function App() {
  const [page, setPage] = useState("shop");
  const [stats, setStats] = useState(null);
  const [policies, setPolicies] = useState([]);
  const [selectedClient, setSelectedClient] = useState("storefront");
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState("success");
  const [simulationResult, setSimulationResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cart, setCart] = useState([]);
  const [policyDraft, setPolicyDraft] = useState(blankPolicy);
  const [analytics, setAnalytics] = useState(null);
  const [clientInput, setClientInput] = useState("storefront");
  const [search, setSearch] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [nextStats, nextPolicies] = await Promise.all([api.stats(), api.policies()]);
      setStats(nextStats);
      setPolicies(nextPolicies);
      setError("");
      const selected = nextPolicies.find((item) => item.client_id === selectedClient);
      if (selected) {
        setPolicyDraft({
          client_id: selected.client_id,
          capacity: selected.capacity,
          refill_rate: selected.refill_rate,
          enabled: selected.enabled,
        });
      }
    } catch (issue) {
      setError(issue.message);
    }
  }, [selectedClient]);

  useEffect(() => { refresh(); }, [refresh]);

  const currentPolicy = policies.find((item) => item.client_id === selectedClient);
  const simulatorPolicy = policies.find((item) => item.client_id === clientInput.trim());
  const filteredProducts = useMemo(
    () => products.filter((item) => `${item.name} ${item.category}`.toLowerCase().includes(search.toLowerCase())),
    [search],
  );

  async function runEvaluation(clientId, route, successMessage) {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const result = await api.evaluate(clientId, route);
      const message = result.allowed
        ? `${successMessage} · ${result.reason === "unconfigured" ? "No policy configured — request passed." : `${result.tokens_remaining?.toFixed(1)} tokens remaining.`}`
        : `Request rejected · bucket empty for ${clientId}.`;
      setSimulationResult({
        total: 1,
        allowed: Number(result.allowed),
        rejected: Number(!result.allowed),
        clientId,
      });
      setNotice(message);
      setNoticeTone(result.allowed ? "success" : "rejected");
      setSelectedClient(clientId);
      setClientInput(clientId);
      await refresh();
      return result;
    } catch (issue) {
      setError(issue.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function simulateBurst(count = 5) {
    setBusy(true);
    setNotice("");
    setError("");
    let allowed = 0;
    let rejected = 0;
    try {
      const results = await Promise.all(
        Array.from({ length: count }, () => api.evaluate(clientInput.trim(), "/api/products")),
      );
      for (const result of results) {
        result.allowed ? allowed += 1 : rejected += 1;
      }
      setSimulationResult({ total: count, allowed, rejected, clientId: clientInput.trim() });
      setNotice("");
      setSelectedClient(clientInput.trim());
      await refresh();
    } catch (issue) {
      setError(issue.message);
    } finally {
      setBusy(false);
    }
  }

  async function savePolicy(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const editing = policies.some((item) => item.client_id === policyDraft.client_id);
      await api.savePolicy({ ...policyDraft, method: editing ? "PUT" : "POST" });
      setSelectedClient(policyDraft.client_id);
      setClientInput(policyDraft.client_id);
      setNotice(`Policy saved for ${policyDraft.client_id}.`);
      setNoticeTone("success");
      await refresh();
    } catch (issue) {
      setError(issue.message);
    } finally {
      setBusy(false);
    }
  }

  async function requestInsights() {
    setBusy(true);
    setAnalytics(null);
    setError("");
    try {
      setAnalytics(await api.analytics());
    } catch (issue) {
      setError(issue.message);
    } finally {
      setBusy(false);
    }
  }

  async function applyRecommendation() {
    if (!analytics?.recommendation) return;
    setPolicyDraft((previous) => ({ ...previous, ...analytics.recommendation }));
    setError("");
    setNotice("Recommendation copied into the policy form. Review it, then save to apply.");
  }

  async function addToCart(product) {
    const result = await runEvaluation(selectedClient, "/api/products", `Added ${product.name} to your bag`);
    if (result?.allowed) setCart((previous) => [...previous, product.id]);
  }

  const eventList = stats?.recent_events || [];
  const navigation = [
    { label: "Workspace", items: [{ id: "shop", title: "Shop demo", icon: ShoppingBag }, { id: "limiter", title: "Rate limiter", icon: Gauge, badge: "LIVE" }] },
    { label: "Manage", items: [{ id: "policies", title: "Policies", icon: ShieldCheck }, { id: "analytics", title: "AI insights", icon: Sparkles }, { id: "logs", title: "Request logs", icon: Activity }] },
  ];

  function navigate(next) {
    setPage(next);
    setMobileOpen(false);
    setNotice("");
    if (next === "analytics" && !analytics) requestInsights();
  }

  return (
    <div className="app-shell">
      {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><ShieldCheck size={21} strokeWidth={2.1} /></div>
          <span>sentinel<span className="brand-ai">ai</span></span>
        </div>
        <button className="workspace-select">
          <span className="workspace-avatar">N</span>
          <span className="workspace-copy"><strong>Northstar Studio</strong><small>Free workspace</small></span>
          <ChevronDown size={15} />
        </button>
        <nav className="main-nav">
          {navigation.map((section) => (
            <div className="nav-section" key={section.label}>
              <div className="nav-label">{section.label}</div>
              {section.items.map(({ id, title, icon: Icon, badge }) => (
                <button key={id} className={`nav-item ${page === id ? "nav-active" : ""}`} onClick={() => navigate(id)}>
                  <Icon size={17} strokeWidth={1.8} /><span>{title}</span>{badge && <span className="nav-live">{badge}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="usage-box">
            <div className="usage-heading"><span>API usage</span><span>{formatNumber(stats?.requests_24h)} / 10k</span></div>
            <div className="usage-track"><div style={{ width: `${Math.min(100, ((stats?.requests_24h || 0) / 10000) * 100)}%` }} /></div>
            <span className="usage-caption">Resets in 12 days</span>
          </div>
          <button className="nav-item"><CircleHelp size={17} /><span>Help center</span></button>
          <button className="profile-button"><div className="profile-avatar">JM</div><span className="profile-copy"><strong>Jamie Morgan</strong><small>Owner</small></span><ChevronDown size={15} /></button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb"><button className="mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={20} /></button><span>Northstar Studio</span><span className="crumb-slash">/</span><strong>{page === "shop" ? "Shop demo" : page === "limiter" ? "Rate limiter" : page === "policies" ? "Policies" : page === "analytics" ? "AI insights" : "Request logs"}</strong></div>
          <div className="top-actions">
            <span className="environment"><span /> All systems operational</span>
            <button className="icon-button" aria-label="Notifications"><Bell size={18} /><i /></button>
            <div className="top-avatar">JM</div>
          </div>
        </header>

        <div className="page-body">
          {error && <div className="alert alert-error"><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}
          {notice && <div className={`alert ${noticeTone === "rejected" ? "alert-rejected" : "alert-success"}`}><span className="alert-icon">{noticeTone === "rejected" ? "!" : <Check size={16} />}</span><span>{notice}</span><button onClick={() => setNotice("")}>Dismiss</button></div>}

          {page === "shop" && (
            <>
              <div className="page-heading shop-heading">
                <div><div className="eyebrow"><span className="live-pulse" /> COMMERCE DEMO</div><h1>Good morning, Jamie <span className="wave">✳</span></h1><p>A little storefront to put your API limits to work.</p></div>
                <div className="heading-actions"><button className="button button-outline" onClick={() => navigate("limiter")}><Gauge size={16} /> Open rate limiter</button><button className="button button-dark" onClick={() => runEvaluation(selectedClient, "/api/products", "Test request passed")} disabled={busy}><Zap size={16} /> Test API request</button></div>
              </div>
              <div className="shop-banner">
                <div className="banner-copy"><span className="banner-kicker">THE EVERYDAY EDIT · NEW COLLECTION</span><h2>Good things.<br />Thoughtfully made.</h2><p>Meet your new favorites, made to keep and made to last.</p><button className="banner-button" onClick={() => document.getElementById("products")?.scrollIntoView({ behavior: "smooth" })}>Explore the collection <ArrowRight size={15} /></button></div>
                <div className="banner-art" aria-hidden="true"><div className="sun-disc" /><div className="banner-vase vase-one" /><div className="banner-vase vase-two" /><div className="banner-leaf leaf-one" /><div className="banner-leaf leaf-two" /><span>01 — 04</span></div>
              </div>
              <div className="section-title-row" id="products"><div><h2>Made for your everyday</h2><p>Small things that make a big difference.</p></div><div className="shop-tools"><label className="search-box"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products" /></label><button className="cart-button"><ShoppingCart size={17} /><span>Bag</span><b>{cart.length}</b></button></div></div>
              <div className="product-grid">
                {filteredProducts.map((product) => <article className="product-card" key={product.id}>
                  <div className={`product-visual art-${product.art}`} style={{ "--product-bg": product.color }}>
                    {product.tag && <span className="product-tag">{product.tag}</span>}<div className="product-shape" aria-hidden="true">{product.glyph}</div><button className="quick-add" aria-label={`Add ${product.name} to bag`} onClick={() => addToCart(product)} disabled={busy}><Plus size={17} /></button>
                  </div>
                  <div className="product-meta"><span>{product.category}</span><span>★ {product.rating}</span></div><div className="product-title-row"><h3>{product.name}</h3><strong>${product.price}</strong></div>
                  <button className="product-add" onClick={() => addToCart(product)} disabled={busy}>Add to bag <ArrowRight size={14} /></button>
                </article>)}
                {filteredProducts.length === 0 && <div className="empty-state">No products match “{search}”.</div>}
              </div>
              <div className="shop-footer"><span>Shop interactions send real demo requests through your Token Bucket policy.</span><button onClick={() => navigate("limiter")}>See live limits <ArrowRight size={14} /></button></div>
            </>
          )}

          {(page === "limiter" || page === "policies") && (
            <>
              <div className="page-heading">
                <div><div className="eyebrow"><span className="live-pulse" /> API PROTECTION</div><h1>Rate limiter</h1><p>Control traffic bursts with token bucket policies.</p></div>
                <div className="heading-actions"><button className="button button-outline" onClick={() => navigate("analytics")}><Sparkles size={16} /> AI insights</button><button className="button button-dark" onClick={() => { setPolicyDraft({ ...blankPolicy, client_id: selectedClient }); document.getElementById("policy-editor")?.scrollIntoView({ behavior: "smooth" }); }}><Plus size={16} /> New policy</button></div>
              </div>
              <div className="stats-grid">
                <StatCard title="Requests (24h)" value={stats?.requests_24h} note="Live" icon={Activity} tone="tone-blue" />
                <StatCard title="Requests allowed" value={stats?.allowed_24h} note={`${stats?.requests_24h ? Math.round((stats.allowed_24h / stats.requests_24h) * 100) : 100}% of requests`} icon={ShieldCheck} tone="tone-green" context="Share of today's traffic" />
                <StatCard title="Requests rejected" value={stats?.rejected_24h} note={stats?.rejected_24h ? "Bucket was empty" : "None today"} icon={LockKeyhole} tone="tone-red" trend={stats?.rejected_24h ? "down" : "up"} />
                <StatCard title="Active policies" value={stats?.active_policies} note="Configured" icon={Code2} tone="tone-violet" />
              </div>
              <div className="dashboard-grid">
                <section className="panel traffic-panel">
                  <div className="panel-heading"><div><h2>Request traffic</h2><p>Activity over the last 24 hours</p></div><button className="range-select">Last 24 hours <ChevronDown size={14} /></button></div>
                  <div className="chart-summary"><strong>{formatNumber(stats?.requests_24h)}</strong><span>total requests</span><span className="traffic-legend"><i /> Allowed <i className="legend-rejected" /> Rejected</span></div>
                  <ActivityChart traffic={stats?.traffic || []} />
                  <div className="chart-labels"><span>24h ago</span><span>18h</span><span>12h</span><span>6h</span><span>Now</span></div>
                </section>
                <section className="panel bucket-panel">
                  <div className="panel-heading"><div><h2>Live token bucket</h2><p>One cup fills for each available token</p></div><span className="status-pill"><span /> LIVE</span></div>
                  <select className="client-select" value={selectedClient} onChange={(event) => { const value = event.target.value; setSelectedClient(value); setClientInput(value); const policy = policies.find((item) => item.client_id === value); if (policy) setPolicyDraft(policy); }}>
                    <option value="storefront">storefront (demo)</option>{policies.filter((item) => item.client_id !== "storefront").map((item) => <option key={item.client_id} value={item.client_id}>{item.client_id}</option>)}
                  </select>
                  {currentPolicy ? <TokenBucket policy={currentPolicy} /> : <div className="unconfigured-state"><Globe2 size={22} /><strong>No policy configured</strong><span>Requests from this client pass through.</span></div>}
                  {currentPolicy && <div className="bucket-facts"><div><span>Capacity</span><strong>{currentPolicy.capacity} tokens</strong></div><div><span>Refill speed</span><strong>{currentPolicy.refill_rate} {currentPolicy.refill_rate === 1 ? "token" : "tokens"} / sec</strong></div></div>}
                  <button className="button button-outline bucket-action" onClick={() => { setPolicyDraft(currentPolicy ? { ...currentPolicy } : { ...blankPolicy, client_id: selectedClient }); document.getElementById("policy-editor")?.scrollIntoView({ behavior: "smooth" }); }}><Settings2 size={15} /> {currentPolicy ? "Configure policy" : "Create first policy"}</button>
                </section>
              </div>
              <div className="dashboard-grid lower-grid">
                <section className="panel events-panel"><div className="panel-heading"><div><h2>Recent requests</h2><p>Green passed · red rejected when the bucket was empty</p></div><button className="text-button" onClick={() => navigate("logs")}>View all <ArrowRight size={14} /></button></div>
                  <EventTable events={eventList} /></section>
                <section className="panel simulator-panel"><div className="panel-heading"><div><h2>Manual simulator</h2><p>Try requests without touching the shop.</p></div><span className="sim-icon"><Zap size={16} /></span></div>
                  <label className="field-label">CLIENT ID<input className="text-input" value={clientInput} onChange={(event) => setClientInput(event.target.value)} placeholder="e.g. storefront" /></label>
                  <div className={`simulator-policy-status ${simulatorPolicy?.enabled ? "policy-status-active" : simulatorPolicy ? "policy-status-paused" : "policy-status-open"}`}><i /><span><strong>{simulatorPolicy?.enabled ? "Rate limit active" : simulatorPolicy ? "Rate limit paused" : "No rate limit policy"}</strong>{simulatorPolicy?.enabled ? ` · ${simulatorPolicy.capacity} tokens, 1 refills every ${secondsPerToken(simulatorPolicy.refill_rate)} sec` : " · All requests pass"}</span></div>
                  <div className="sim-buttons"><button className="button button-dark" disabled={busy || !clientInput.trim()} onClick={() => runEvaluation(clientInput.trim(), "/api/demo", "Demo request processed")}>Send 1 request <ArrowRight size={15} /></button><button className="button button-outline" disabled={busy || !clientInput.trim()} onClick={() => simulateBurst(10)}><Zap size={15} /> Send burst × 10</button></div>
                  <p className="muted-note">{simulatorPolicy?.enabled ? "A burst sends 10 requests together. Requests above the available tokens are rejected." : "Enable a policy above to see requests get rejected. Without an enabled policy, requests pass by default."}</p>
                  {simulationResult && <div className={`simulation-result ${simulationResult.rejected ? "simulation-result-rejected" : "simulation-result-allowed"}`} role="status">
                    <div className="simulation-result-heading"><strong>{simulationResult.rejected ? "Some requests were rejected" : "All requests were allowed"}</strong><span>{simulationResult.total} sent · {simulationResult.clientId}</span></div>
                    <div className="simulation-counts"><span><i className="dot-green" /> {simulationResult.allowed} allowed</span><span><i className="dot-red" /> {simulationResult.rejected} rejected</span></div>
                    {simulationResult.rejected > 0 && <p>{simulationResult.rejected} request{simulationResult.rejected === 1 ? " was" : "s were"} stopped because the bucket ran out of tokens.</p>}
                  </div>}
                </section>
              </div>
              <section className="panel policy-editor" id="policy-editor"><div className="panel-heading"><div><h2>Policy configuration</h2><p>Manually set the burst size and token refill speed.</p></div><span className="config-badge"><Settings2 size={14} /> MANUAL CONTROL</span></div>
                <form className="policy-form" onSubmit={savePolicy}>
                  <label className="field-label">CLIENT ID<input className="text-input" required maxLength="100" value={policyDraft.client_id} onChange={(event) => setPolicyDraft({ ...policyDraft, client_id: event.target.value })} placeholder="storefront" /></label>
                  <label className="field-label">BUCKET CAPACITY<input className="text-input" type="number" required min="1" max="100000" value={policyDraft.capacity} onChange={(event) => setPolicyDraft({ ...policyDraft, capacity: event.target.value })} /><small>Maximum requests in a burst</small></label>
                  <label className="field-label">SECONDS PER TOKEN<input className="text-input" type="number" required min="0.01" step="any" max="100000" value={secondsPerToken(policyDraft.refill_rate)} onChange={(event) => { const seconds = Number(event.target.value); setPolicyDraft({ ...policyDraft, refill_rate: seconds > 0 ? 1 / seconds : policyDraft.refill_rate }); }} /><small>Time for the bucket to refill by one token</small></label>
                  <label className="policy-enabled"><input type="checkbox" checked={policyDraft.enabled ?? true} onChange={(event) => setPolicyDraft({ ...policyDraft, enabled: event.target.checked })} /><span><strong>Enable rate limiting</strong><small>Disabled policies allow every request.</small></span></label>
                  <div className="form-footer"><span>Requests with no policy are allowed by default.</span><button className="button button-dark" disabled={busy}><Check size={15} /> Save policy</button></div>
                </form>
              </section>
            </>
          )}

          {(page === "analytics" || page === "overview") && page === "analytics" && (
            <>
              <div className="page-heading"><div><div className="eyebrow"><Sparkles size={13} /> OPTIONAL AI ANALYTICS</div><h1>Traffic, in context.</h1><p>Thoughtful recommendations from your aggregated request data.</p></div><button className="button button-dark" onClick={requestInsights} disabled={busy}><Sparkles size={16} /> {busy ? "Analyzing…" : "Refresh insights"}</button></div>
              <section className="insights-hero"><div className="insight-orbit"><div><Sparkles size={25} /></div></div><div><span className="insight-kicker">{analytics?.source === "ai" ? "AI-POWERED ANALYSIS" : "LOCAL TRAFFIC ANALYSIS"}</span><h2>{analytics?.explanation || "Your traffic story is taking shape."}</h2><p>{analytics?.disclaimer || "Insights are advisory only. No AI model makes live allow or deny decisions."}</p></div><span className="insight-stars">✳</span></section>
              <section className="panel recommendation-panel"><div className="panel-heading"><div><h2>Suggested starting point</h2><p>Review these values before updating any policy.</p></div><span className="recommendation-tag"><Sparkles size={13} /> ADVISORY</span></div>
                {analytics?.recommendation ? <div className="recommendation-content"><div className="recommendation-metrics"><div><span>Bucket capacity</span><strong>{analytics.recommendation.capacity}<small> tokens</small></strong></div><div><span>Refill rate</span><strong>{analytics.recommendation.refill_rate}<small> / sec</small></strong></div></div><p>{analytics.recommendation.reason}</p><div className="recommendation-footer"><span>Nothing changes until you review and save a policy.</span><button className="button button-dark" onClick={applyRecommendation}>Review recommendation <ArrowRight size={15} /></button></div></div> : <div className="empty-insights"><button className="button button-outline" onClick={requestInsights}><Sparkles size={15} /> Generate insights</button></div>}
              </section>
              <div className="stats-grid analytics-stats"><StatCard title="Total requests" value={stats?.total_requests} note="Requests logged" icon={Activity} tone="tone-blue" context="All time" /><StatCard title="Allowed" value={stats?.allowed} note="Requests passed" icon={ShieldCheck} tone="tone-green" context="All time" /><StatCard title="Rejected" value={stats?.rejected} note="Requests stopped" icon={LockKeyhole} tone="tone-red" context="All time" /><StatCard title="Active policies" value={stats?.active_policies} note="Clients" icon={Code2} tone="tone-violet" context="Right now" /></div>
            </>
          )}

          {page === "logs" && <><div className="page-heading"><div><div className="eyebrow"><Activity size={13} /> REQUEST HISTORY</div><h1>Request logs</h1><p>Recent decisions, including the reason behind each one.</p></div><button className="button button-outline" onClick={refresh}><Activity size={15} /> Refresh logs</button></div><section className="panel full-events"><div className="panel-heading"><div><h2>Latest 100 events</h2><p>Allowed and rejected API calls</p></div></div><EventTable events={stats?.events || []} expanded /></section></>}
        </div>
        <footer className="app-footer"><span>SentinelAI <span>·</span> API traffic, thoughtfully protected.</span><div><span><LockKeyhole size={13} /> Local SQLite</span><span><Zap size={13} /> Token bucket</span><button onClick={() => refresh()}><Activity size={13} /> API status</button></div></footer>
      </main>
    </div>
  );
}

function EventTable({ events, expanded = false }) {
  if (!events.length) return <div className="table-empty"><Activity size={18} /><span>No requests yet. Send one from the manual simulator or shop.</span></div>;
  return (
    <div className={`event-table ${expanded ? "event-table-expanded" : ""}`}>
      <div className="event-row event-header"><span>CLIENT / ROUTE</span><span>DECISION</span><span>REMAINING</span><span>TIME</span></div>
      {events.map((event) => <div className={`event-row ${event.allowed ? "" : "event-row-rejected"}`} key={event.id}><div className="event-client"><span className={`client-dot ${event.allowed ? "dot-green" : "dot-red"}`} /><span><strong>{event.client_id}</strong><small>{event.allowed ? event.route : `Bucket empty · ${event.route}`}</small></span></div><span className={`decision ${event.allowed ? "decision-allow" : "decision-deny"}`}>{event.allowed ? "Allowed" : "Rejected"}</span><span className="token-value">{event.tokens_remaining == null ? "—" : `${Number(event.tokens_remaining).toFixed(1)} tokens`}</span><span className="event-time"><Clock3 size={13} />{new Date(event.created_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>)}
    </div>
  );
}

export default App;
