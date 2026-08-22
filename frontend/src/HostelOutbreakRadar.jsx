import React, { useState, useMemo, useCallback, useEffect } from "react";
import { BOYS_HOSTELS as BOYS, GIRLS_HOSTELS as GIRLS } from "./campusData";

// Point this at wherever the FastAPI backend is running.
// (Leave empty string to hit same-origin, e.g. when the frontend is
// reverse-proxied behind the API in production.)
const API_BASE = "http://localhost:8000";

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------
// Every authenticated backend endpoint reads the caller's session from the
// X-Session-Token header (see backend/auth.py: get_current_session /
// require_role) - there is no bearer/JWT scheme, matching main.py exactly.

async function apiFetch(path, { token, method = "GET", body } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["X-Session-Token"] = token;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.detail) detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {
      /* ignore - not JSON */
    }
    throw new Error(detail);
  }

  if (res.status === 204) return null;
  return res.json();
}

function login(name, role) {
  // Matches main.py: POST /login { name, role } -> { session_token, name, role }
  return apiFetch("/login", { method: "POST", body: { name, role } });
}

function riskState(score) {
  if (score >= 80) return { label: "PROBABLE", key: "red" };
  if (score >= 60) return { label: "SUSPECTED", key: "orange" };
  if (score >= 30) return { label: "WATCH", key: "yellow" };
  return { label: "NORMAL", key: "green" };
}

const COLORS = {
  green: { fill: "#12271d", border: "#2f6b47", text: "#5fd694", glow: "rgba(95,214,148,0.18)" },
  yellow: { fill: "#2b2612", border: "#8a7420", text: "#eccb4d", glow: "rgba(236,203,77,0.18)" },
  orange: { fill: "#2e1c0f", border: "#a85a1f", text: "#f0954a", glow: "rgba(240,149,74,0.2)" },
  red: { fill: "#301213", border: "#b23b3f", text: "#f2606a", glow: "rgba(242,96,106,0.25)" },
};

const ADVISORY_MESSAGE =
  "An unusual increase in gastrointestinal symptoms has been detected in your block. " +
  "Please follow standard hygiene precautions and report symptoms to the campus health " +
  "center if they develop.";

// Advisories/health-center panels stay clearly labeled SIMULATED (the
// backend has no notification system - see README "Not Yet Implemented").
// They're now built from the real /dashboard/alerts data instead of
// fabricated block state, so the severities and evidence shown are real.
function buildAdvisories(alerts) {
  return alerts
    .filter((a) => a.severity === "PROBABLE")
    .map((a) => ({
      id: `adv_${a.block_id}`,
      block: a.block_id,
      severity: a.severity,
      message: ADVISORY_MESSAGE,
      status: "SIMULATED",
    }));
}

function formatTimestamp(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function KpiCard({ label, value, sub, tone }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={tone ? { color: tone } : undefined}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

function BlockNode({ block, selected, onSelect }) {
  const st = riskState(block.risk_score);
  const c = COLORS[st.key];
  return (
    <button
      className={"block-node" + (selected ? " block-node--selected" : "")}
      style={{
        background: c.fill,
        borderColor: selected ? c.text : c.border,
        boxShadow: selected ? `0 0 0 3px ${c.glow}` : "none",
      }}
      onClick={() => onSelect(block.block_id)}
      aria-pressed={selected}
      title={`${block.block_id} \u2014 ${st.label}`}
    >
      <span className="block-id">{block.block_id}</span>
      <span className="block-cases">{block.current_cases}</span>
      <span className="block-state" style={{ color: c.text }}>{st.label}</span>
    </button>
  );
}

function MessNode({ label, sub }) {
  return (
    <div className="mess-node">
      <div className="mess-icon">\u2622</div>
      <div className="mess-label">{label}</div>
      <div className="mess-sub">{sub}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Login (staff / clinic role)
// ---------------------------------------------------------------------------

function LoginGate({ onLogin }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Enter your name.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const data = await login(name.trim(), "clinic");
      onLogin({ name: data.name, role: data.role, token: data.session_token });
    } catch (err) {
      setError(err.message || "Couldn\u2019t reach the backend. Check it\u2019s running on " + API_BASE);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-mark">\u25C9</div>
        <h1 className="login-title">Hostel Outbreak Radar</h1>
        <p className="login-sub">Campus health staff sign-in. No password \u2014 this is a hackathon-simple session, see backend/auth.py.</p>
        <form onSubmit={submit}>
          <label className="login-label" htmlFor="staffName">Name</label>
          <input id="staffName" className="login-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Health Desk Staff" autoComplete="name" />
          {error && <div className="login-error">{error}</div>}
          <button className="login-btn" type="submit" disabled={loading}>{loading ? "Signing in\u2026" : "Sign in"}</button>
        </form>
        <div className="login-foot">
          Authenticates against POST /login and stores the returned session token (sent back as X-Session-Token).
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report form (anonymous student role)
// ---------------------------------------------------------------------------

const SYMPTOM_OPTIONS = ["Nausea", "Vomiting", "Diarrhea", "Abdominal pain", "Fever", "Headache"];
const SEVERITY_OPTIONS = ["Mild", "Moderate", "Severe"];
const FOOD_EXPOSURE_OPTIONS = ["Mess A", "Mess B", "Outside food"];

function makeAnonId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "anon_";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function ReportForm({ onBack }) {
  const [anonId] = useState(makeAnonId);
  const [studentToken, setStudentToken] = useState(null);
  const [tokenError, setTokenError] = useState("");
  const [block, setBlock] = useState("");
  const [symptoms, setSymptoms] = useState([]);
  const [severity, setSeverity] = useState("");
  const [onsetTime, setOnsetTime] = useState("");
  const [foodExposure, setFoodExposure] = useState("");
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState("idle"); // idle | loading | success | error
  const [serverError, setServerError] = useState("");

  // POST /reports requires the "student" role (see auth.require_role in
  // main.py). There's no visible student login screen by design (reports
  // are anonymous), so we silently open a student session on mount using
  // the same anonymous id shown to the person, and reuse that token when
  // the report is actually submitted.
  useEffect(() => {
    let cancelled = false;
    login(anonId, "student")
      .then((data) => { if (!cancelled) setStudentToken(data.session_token); })
      .catch((err) => { if (!cancelled) setTokenError(err.message || "Couldn\u2019t reach the backend."); });
    return () => { cancelled = true; };
  }, [anonId]);

  const toggleSymptom = (s) => {
    setSymptoms((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  const validate = () => {
    const e = {};
    if (!block) e.block = "Select your block.";
    if (symptoms.length === 0) e.symptoms = "Select at least one symptom.";
    if (!severity) e.severity = "Select a severity.";
    if (!onsetTime) e.onsetTime = "Enter when symptoms started.";
    else {
      const onsetDate = new Date(onsetTime);
      if (isNaN(onsetDate.getTime())) e.onsetTime = "Enter a valid date and time.";
      else if (onsetDate.getTime() > Date.now() + 5 * 60000) e.onsetTime = "Onset time can\u2019t be in the future.";
    }
    if (!foodExposure) e.foodExposure = "Select a recent food exposure.";
    return e;
  };

  const submit = async (ev) => {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    if (!studentToken) {
      setServerError(tokenError || "Still establishing a session \u2014 try again in a moment.");
      setStatus("error");
      return;
    }

    const payload = {
      anonymous_student_id: anonId,
      block,
      symptoms: symptoms.map((s) => s.toLowerCase()),
      severity: severity.toLowerCase(),
      onset_time: new Date(onsetTime).toISOString(),
      food_exposure: foodExposure === "Outside food" ? "OUTSIDE_FOOD" : foodExposure === "Mess A" ? "MESS_A" : "MESS_B",
    };

    setStatus("loading");
    setServerError("");
    try {
      await apiFetch("/reports", { method: "POST", token: studentToken, body: payload });
      setStatus("success");
    } catch (err) {
      setServerError(err.message || "The server rejected this report. Check the fields and try again.");
      setStatus("error");
    }
  };

  const resetForm = () => {
    setBlock("");
    setSymptoms([]);
    setSeverity("");
    setOnsetTime("");
    setFoodExposure("");
    setErrors({});
    setStatus("idle");
    setServerError("");
  };

  if (status === "success") {
    return (
      <div className="report-wrap">
        <div className="report-card report-card--success">
          <div className="success-icon">\u2713</div>
          <h1 className="report-title">Report received</h1>
          <p className="report-sub">Thanks \u2014 your symptom report has been logged anonymously. No further action needed. If symptoms worsen, contact the campus health center directly.</p>
          <button className="report-btn" onClick={resetForm}>Submit another report</button>
          {onBack && <button className="report-link" onClick={onBack}>Back</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="report-wrap">
      <div className="report-card">
        <h1 className="report-title">Report symptoms</h1>
        <p className="report-sub">Anonymous, takes under a minute. Your report ID: <code>{anonId}</code></p>

        <form onSubmit={submit} noValidate>
          <div className="field">
            <label className="field-label" htmlFor="block">Block</label>
            <select id="block" className="field-input" value={block} onChange={(e) => setBlock(e.target.value)}>
              <option value="">Select block</option>
              <optgroup label="Boys">
                {BOYS.map((b) => <option key={b} value={b}>{b}</option>)}
              </optgroup>
              <optgroup label="Girls">
                {GIRLS.map((b) => <option key={b} value={b}>{b}</option>)}
              </optgroup>
            </select>
            {errors.block && <div className="field-error">{errors.block}</div>}
          </div>

          <div className="field">
            <label className="field-label">Symptoms</label>
            <div className="chip-grid">
              {SYMPTOM_OPTIONS.map((s) => (
                <button
                  type="button"
                  key={s}
                  className={"chip" + (symptoms.includes(s) ? " chip--active" : "")}
                  onClick={() => toggleSymptom(s)}
                  aria-pressed={symptoms.includes(s)}
                >
                  {s}
                </button>
              ))}
            </div>
            {errors.symptoms && <div className="field-error">{errors.symptoms}</div>}
          </div>

          <div className="field">
            <label className="field-label">Severity</label>
            <div className="chip-grid chip-grid--3">
              {SEVERITY_OPTIONS.map((s) => (
                <button
                  type="button"
                  key={s}
                  className={"chip chip--severity" + (severity === s ? " chip--active" : "")}
                  onClick={() => setSeverity(s)}
                  aria-pressed={severity === s}
                >
                  {s}
                </button>
              ))}
            </div>
            {errors.severity && <div className="field-error">{errors.severity}</div>}
          </div>

          <div className="field">
            <label className="field-label" htmlFor="onset">Approximate symptom onset</label>
            <input
              id="onset"
              type="datetime-local"
              className="field-input"
              value={onsetTime}
              onChange={(e) => setOnsetTime(e.target.value)}
              max={new Date(Date.now() + 5 * 60000).toISOString().slice(0, 16)}
            />
            {errors.onsetTime && <div className="field-error">{errors.onsetTime}</div>}
          </div>

          <div className="field">
            <label className="field-label">Recent food exposure</label>
            <div className="chip-grid chip-grid--3">
              {FOOD_EXPOSURE_OPTIONS.map((f) => (
                <button
                  type="button"
                  key={f}
                  className={"chip" + (foodExposure === f ? " chip--active" : "")}
                  onClick={() => setFoodExposure(f)}
                  aria-pressed={foodExposure === f}
                >
                  {f}
                </button>
              ))}
            </div>
            {errors.foodExposure && <div className="field-error">{errors.foodExposure}</div>}
          </div>

          {status === "error" && <div className="submit-error">{serverError}</div>}

          <button className="report-btn" type="submit" disabled={status === "loading"}>
            {status === "loading" ? "Submitting\u2026" : "Submit report"}
          </button>
          {onBack && <button type="button" className="report-link" onClick={onBack}>Back</button>}
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard panels
// ---------------------------------------------------------------------------

function AdvisoryPanel({ advisories }) {
  return (
    <section className="panel advisory-panel">
      <div className="panel-head">
        <h2>Simulated resident advisories</h2>
        <span className="sim-badge">SIMULATED \u2014 no real notification sent</span>
      </div>
      {advisories.length === 0 ? (
        <div className="empty-state">No block is currently PROBABLE. No advisories generated.</div>
      ) : (
        <ul className="advisory-list">
          {advisories.map((a) => (
            <li key={a.id} className="advisory-item">
              <div className="advisory-item-head">
                <span className="advisory-block">{a.block}</span>
                <span className="advisory-severity" style={{ color: COLORS.red.text }}>{a.severity}</span>
              </div>
              <p className="advisory-message">{a.message}</p>
              <div className="advisory-meta">
                <span />
                <span className="advisory-status">{a.status}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HealthCenterPanel({ alerts }) {
  return (
    <section className="panel healthcenter-panel">
      <div className="panel-head">
        <h2>Health-center alerts</h2>
        <span className="sim-badge">from /dashboard/alerts</span>
      </div>
      {alerts.length === 0 ? (
        <div className="empty-state">No active health-center alerts.</div>
      ) : (
        <ul className="hc-list">
          {alerts.map((a) => (
            <li key={a.block_id} className="hc-item">
              <div className="hc-item-head">
                <span className="hc-block">{a.block_id}</span>
                <span className="hc-time">{riskState(a.risk_score).label}</span>
              </div>
              <div className="hc-grid">
                <div><span>Case count</span><strong>{a.current_cases}</strong></div>
                <div><span>Risk score</span><strong>{a.risk_score}</strong></div>
                <div><span>Common exposure</span><strong>{a.common_exposure}</strong></div>
              </div>
              <div className="hc-evidence">
                <span className="hc-evidence-label">Supporting evidence</span>
                <ul>
                  {a.explanation.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
              <div className="hc-foot">This is a statistical signal, not a diagnosis. Individual identities are not included.</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Landing({ onPickStudent, onPickStaff }) {
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-mark">\u25C9</div>
        <h1 className="login-title">Hostel Outbreak Radar</h1>
        <p className="login-sub">Choose how you\u2019d like to continue.</p>
        <button className="report-btn" onClick={onPickStudent}>Report symptoms (student, anonymous)</button>
        <button className="login-btn" style={{ marginTop: 10, background: "transparent", color: "#cdd3e0", border: "1px solid rgba(255,255,255,0.15)" }} onClick={onPickStaff}>
          Staff sign-in
        </button>
      </div>
    </div>
  );
}

const POLL_INTERVAL_MS = 20000;

export default function App() {
  const [view, setView] = useState("landing"); // landing | report | login | dashboard
  const [session, setSession] = useState(null);

  const [blocks, setBlocks] = useState([]);
  const [overview, setOverview] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(false);

  const [selectedId, setSelectedId] = useState(null);
  const [sourceAttribution, setSourceAttribution] = useState(null);
  const [sourceLoading, setSourceLoading] = useState(false);

  const loadDashboard = useCallback(async (token) => {
    setLoading(true);
    try {
      const [blocksData, overviewData, alertsData] = await Promise.all([
        apiFetch("/dashboard/blocks", { token }),
        apiFetch("/dashboard/overview", { token }),
        apiFetch("/dashboard/alerts", { token }),
      ]);
      setBlocks(blocksData);
      setOverview(overviewData);
      setAlerts(alertsData.alerts);
      setLoadError("");
    } catch (err) {
      setLoadError(err.message || "Couldn\u2019t load dashboard data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    loadDashboard(session.token);
    const interval = setInterval(() => loadDashboard(session.token), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [session, loadDashboard]);

  useEffect(() => {
    if (!session || !selectedId) { setSourceAttribution(null); return; }
    let cancelled = false;
    setSourceLoading(true);
    apiFetch(`/dashboard/sources?block=${selectedId}`, { token: session.token })
      .then((data) => { if (!cancelled) setSourceAttribution(data.blocks[0] || null); })
      .catch(() => { if (!cancelled) setSourceAttribution(null); })
      .finally(() => { if (!cancelled) setSourceLoading(false); });
    return () => { cancelled = true; };
  }, [session, selectedId]);

  const selected = useMemo(() => blocks.find((b) => b.block_id === selectedId) || null, [blocks, selectedId]);
  const handleSelect = useCallback((id) => setSelectedId(id), []);

  const advisories = useMemo(() => buildAdvisories(alerts), [alerts]);

  if (view === "landing") {
    return <Landing onPickStudent={() => setView("report")} onPickStaff={() => setView("login")} />;
  }
  if (view === "report") {
    return <ReportForm onBack={() => setView("landing")} />;
  }
  if (!session) {
    return <LoginGate onLogin={(s) => { setSession(s); setView("dashboard"); }} />;
  }

  const st = selected ? riskState(selected.risk_score) : null;
  const c = st ? COLORS[st.key] : null;
  const boysBlocks = blocks.filter((b) => b.gender === "boys");
  const girlsBlocks = blocks.filter((b) => b.gender === "girls");

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <span className="topbar-mark">\u25C9</span>
          <span className="topbar-title">HOSTEL OUTBREAK RADAR</span>
          <span className="topbar-pill">{loading ? "REFRESHING\u2026" : "LIVE"}</span>
        </div>
        <div className="topbar-right">
          <button className="demo-btn demo-btn--reset" onClick={() => loadDashboard(session.token)} disabled={loading}>
            Refresh now
          </button>
          <span className="session-info">{session.name} \u00B7 {session.role}</span>
          <button className="logout-btn" onClick={() => { setSession(null); setView("landing"); }}>Sign out</button>
        </div>
      </header>

      {loadError && <div className="demo-banner">{loadError}</div>}

      <main className="grid">
        {overview && (
          <section className="kpi-row">
            <KpiCard label="Active cases" value={overview.total_active_cases} sub="across 20 blocks" />
            <KpiCard label="Cases today" value={overview.cases_today} sub="most recent reporting date" />
            <KpiCard
              label="Highest risk"
              value={overview.highest_risk_block ? `${overview.highest_risk_block.block_id} \u00B7 ${overview.highest_risk_block.risk_score}` : "\u2014"}
              sub={overview.highest_risk_block ? overview.highest_risk_block.severity : "no active risk"}
              tone={overview.highest_risk_block ? COLORS[riskState(overview.highest_risk_block.risk_score).key].text : undefined}
            />
            <KpiCard
              label="Baseline deviation"
              value={`${overview.baseline_deviation_pct > 0 ? "+" : ""}${overview.baseline_deviation_pct}%`}
              sub="vs. rolling baseline"
              tone={overview.baseline_deviation_pct > 30 ? COLORS.red.text : undefined}
            />
          </section>
        )}

        <section className="panel radar-panel">
          <div className="panel-head">
            <h2>Interactive campus radar</h2>
            <div className="legend">
              <span><i className="dot" style={{ background: COLORS.green.text }} />Normal</span>
              <span><i className="dot" style={{ background: COLORS.yellow.text }} />Watch</span>
              <span><i className="dot" style={{ background: COLORS.orange.text }} />Suspected</span>
              <span><i className="dot" style={{ background: COLORS.red.text }} />Probable</span>
            </div>
          </div>
          <div className="campus-layout">
            <div className="wing">
              <div className="wing-label">Boys hostels</div>
              <div className="block-grid block-grid--boys">
                {boysBlocks.map((b) => (
                  <BlockNode key={b.block_id} block={b} selected={b.block_id === selectedId} onSelect={handleSelect} />
                ))}
              </div>
            </div>

            <div className="mess-row">
              <MessNode label="Mess A" sub="campus dining hall" />
              <MessNode label="Mess B" sub="campus dining hall" />
              <MessNode label="Outside food" sub="off-campus / unaffiliated" />
            </div>

            <div className="wing">
              <div className="wing-label">Girls hostels</div>
              <div className="block-grid block-grid--girls">
                {girlsBlocks.map((b) => (
                  <BlockNode key={b.block_id} block={b} selected={b.block_id === selectedId} onSelect={handleSelect} />
                ))}
              </div>
            </div>
          </div>
          <div className="radar-foot">Schematic layout \u2014 not geographic. Block position and spacing are illustrative only.</div>
        </section>

        <section className="panel detail-panel">
          <div className="panel-head">
            <h2>Selected block detail</h2>
          </div>
          {selected ? (
            <div className="detail-body">
              <div className="detail-top" style={{ borderColor: c.border }}>
                <div>
                  <div className="detail-block-id">{selected.block_id}</div>
                  <div className="detail-block-wing">{selected.gender === "boys" ? "Boys" : "Girls"} hostel</div>
                </div>
                <div className="detail-risk" style={{ color: c.text }}>
                  <div className="detail-risk-score">{selected.risk_score}</div>
                  <div className="detail-risk-label">{st.label}</div>
                </div>
              </div>
              <div className="detail-grid">
                <div className="detail-item"><span>Reported cases</span><strong>{selected.current_cases}</strong></div>
                <div className="detail-item"><span>Baseline</span><strong>{selected.baseline_cases}</strong></div>
                <div className="detail-item"><span>Growth factor</span><strong>{selected.trend.growth_factor}x</strong></div>
                <div className="detail-item"><span>Trend</span><strong>{selected.trend.description}</strong></div>
                <div className="detail-item detail-item--wide"><span>Dominant symptoms</span><strong>{selected.dominant_symptoms.join(", ") || "\u2014"}</strong></div>
                <div className="detail-item detail-item--wide"><span>Common food exposure</span><strong>{selected.common_exposure}</strong></div>
              </div>
            </div>
          ) : (
            <div className="empty-state">Select a block on the radar to see details.</div>
          )}
        </section>

        <section className="panel explain-panel">
          <div className="panel-head"><h2>Outbreak risk explanation</h2></div>
          {selected ? (
            selected.explanation.length > 0 ? (
              <ul className="timeline">
                {selected.explanation.map((reason, i) => (
                  <li key={i} className="timeline-item">
                    <span className="timeline-dot" style={{ background: c.text }} />
                    <div className="timeline-text">{reason}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="explain-text">No specific risk factors flagged for this block.</p>
            )
          ) : (
            <p className="explain-text">Select a block to see why it is or isn\u2019t flagged.</p>
          )}
        </section>

        <section className="panel source-panel">
          <div className="panel-head"><h2>Source attribution</h2></div>
          {!selected ? (
            <div className="empty-state">No block selected.</div>
          ) : sourceLoading ? (
            <div className="empty-state">Running attribution\u2026</div>
          ) : sourceAttribution && sourceAttribution.top_suspected_exposure ? (
            <div className="source-body">
              <div className="source-row">
                <span>Likely source</span>
                <strong>{sourceAttribution.top_suspected_exposure.exposure}</strong>
              </div>
              <div className="source-bar-wrap">
                <div className="source-bar-track">
                  <div
                    className="source-bar-fill"
                    style={{ width: `${sourceAttribution.top_suspected_exposure.affected_exposure_pct}%`, background: c.text }}
                  />
                </div>
                <span className="source-bar-label">
                  {sourceAttribution.top_suspected_exposure.affected_exposure_pct}% of affected reporters in {selected.block_id} were exposed \u2014 association: {sourceAttribution.top_suspected_exposure.association}
                </span>
              </div>
              <div className="source-note">{sourceAttribution.disclaimer}</div>
            </div>
          ) : (
            <div className="empty-state">No strong source association found for this block.</div>
          )}
        </section>

        <section className="panel timeline-panel">
          <div className="panel-head"><h2>Active alerts</h2></div>
          {alerts.length === 0 ? (
            <div className="empty-state">No alerts yet.</div>
          ) : (
            <ul className="timeline">
              {alerts.map((a) => (
                <li key={a.block_id} className="timeline-item">
                  <span className="timeline-dot" style={{ background: COLORS[riskState(a.risk_score).key].text }} />
                  <div>
                    <div className="timeline-text">{a.block_id} risk reached {a.risk_score} ({riskState(a.risk_score).label}) \u2014 common exposure {a.common_exposure}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <AdvisoryPanel advisories={advisories} />
        <HealthCenterPanel alerts={alerts} />

      </main>

      <style>{`
        * { box-sizing: border-box; }
        .app {
          min-height: 100vh;
          background: radial-gradient(1200px 600px at 20% -10%, #131a29 0%, #0a0e16 55%), #0a0e16;
          color: #e6e9f0;
          font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
          padding-bottom: 3rem;
        }
        .topbar {
          display: flex; justify-content: space-between; align-items: center;
          padding: 18px 28px;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          background: rgba(13,17,23,0.6);
          backdrop-filter: blur(12px);
          position: sticky; top: 0; z-index: 10;
          flex-wrap: wrap;
          gap: 10px;
        }
        .topbar-left { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .topbar-mark { color: #5b8cf0; font-size: 18px; }
        .topbar-title { font-size: 15px; font-weight: 600; letter-spacing: 0.12em; }
        .topbar-pill {
          font-size: 10px; letter-spacing: 0.08em; padding: 3px 9px; border-radius: 999px;
          background: rgba(95,214,148,0.12); color: #5fd694; border: 1px solid rgba(95,214,148,0.3);
        }
        .topbar-right { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
        .session-info { font-size: 12px; color: #8b93a5; }
        .logout-btn {
          background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12);
          color: #cdd3e0; font-size: 12px; padding: 6px 12px; border-radius: 8px; cursor: pointer;
        }
        .logout-btn:hover { background: rgba(255,255,255,0.1); }

        .demo-btn {
          font-size: 12px; font-weight: 600; padding: 7px 14px; border-radius: 8px; cursor: pointer;
          font-family: inherit; border: 1px solid transparent;
        }
        .demo-btn--reset { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.12); color: #cdd3e0; }
        .demo-btn--reset:hover { background: rgba(255,255,255,0.1); }
        .demo-btn--reset:disabled { opacity: 0.6; cursor: not-allowed; }

        .demo-banner {
          text-align: center; font-size: 11.5px; color: #f2606a; background: rgba(242,96,106,0.08);
          border-bottom: 1px solid rgba(242,96,106,0.2); padding: 6px 12px; letter-spacing: 0.02em;
        }

        .grid {
          max-width: 1400px; margin: 0 auto; padding: 24px 28px;
          display: grid;
          grid-template-columns: 1.6fr 1fr;
          gap: 18px;
        }
        .kpi-row { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
        .kpi-card {
          background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px; padding: 16px 18px; backdrop-filter: blur(8px);
        }
        .kpi-label { font-size: 11px; letter-spacing: 0.06em; color: #8b93a5; text-transform: uppercase; margin-bottom: 8px; }
        .kpi-value { font-size: 26px; font-weight: 600; color: #f1f3f8; }
        .kpi-sub { font-size: 12px; color: #6b7280; margin-top: 4px; }

        .panel {
          background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px; padding: 20px 22px; backdrop-filter: blur(8px);
        }
        .panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
        .panel-head h2 { font-size: 14px; font-weight: 600; letter-spacing: 0.02em; color: #d6dae4; margin: 0; }

        .radar-panel { grid-row: span 2; }
        .legend { display: flex; gap: 12px; font-size: 11px; color: #8b93a5; }
        .legend span { display: flex; align-items: center; gap: 5px; }
        .dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }

        .campus-layout { display: flex; flex-direction: column; gap: 16px; }
        .wing-label { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #6b7280; margin-bottom: 8px; }
        .block-grid { display: grid; gap: 8px; }
        .block-grid--boys { grid-template-columns: repeat(6, 1fr); }
        .block-grid--girls { grid-template-columns: repeat(8, 1fr); }

        .block-node {
          border: 1px solid; border-radius: 10px; padding: 8px 4px;
          display: flex; flex-direction: column; align-items: center; gap: 2px;
          cursor: pointer; transition: transform 0.12s ease, box-shadow 0.12s ease;
          font-family: inherit;
        }
        .block-node:hover { transform: translateY(-2px); }
        .block-id { font-size: 11px; font-weight: 600; color: #e6e9f0; }
        .block-cases { font-size: 15px; font-weight: 700; color: #f1f3f8; }
        .block-state { font-size: 8px; letter-spacing: 0.05em; }

        .mess-row { display: flex; flex-wrap: wrap; gap: 10px; padding: 10px 0; border-top: 1px dashed rgba(255,255,255,0.1); border-bottom: 1px dashed rgba(255,255,255,0.1); }
        .mess-node { flex: 1 1 120px; background: rgba(91,140,240,0.08); border: 1px solid rgba(91,140,240,0.25); border-radius: 10px; padding: 10px; text-align: center; }
        .mess-icon { font-size: 16px; color: #5b8cf0; }
        .mess-label { font-size: 12px; font-weight: 600; color: #cdd3e0; margin-top: 2px; }
        .mess-sub { font-size: 10px; color: #6b7280; margin-top: 1px; }

        .radar-foot { font-size: 11px; color: #5a6070; margin-top: 12px; text-align: right; font-style: italic; }

        .detail-body { display: flex; flex-direction: column; gap: 14px; }
        .detail-top { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid; padding-bottom: 12px; }
        .detail-block-id { font-size: 22px; font-weight: 700; }
        .detail-block-wing { font-size: 12px; color: #8b93a5; }
        .detail-risk { text-align: right; }
        .detail-risk-score { font-size: 24px; font-weight: 700; }
        .detail-risk-label { font-size: 10px; letter-spacing: 0.08em; }

        .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .detail-item {
          background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
          border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px;
        }
        .detail-item--wide { grid-column: 1 / -1; }
        .detail-item span { font-size: 10px; color: #8b93a5; text-transform: uppercase; letter-spacing: 0.05em; }
        .detail-item strong { font-size: 14px; color: #eef0f5; font-weight: 600; }

        .empty-state { color: #6b7280; font-size: 13px; padding: 20px 0; text-align: center; }

        .explain-text { font-size: 13px; line-height: 1.65; color: #c3c8d4; margin: 0; }

        .source-row { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 12px; }
        .source-row strong { color: #eef0f5; }
        .source-bar-track { height: 8px; border-radius: 999px; background: rgba(255,255,255,0.06); overflow: hidden; }
        .source-bar-fill { height: 100%; border-radius: 999px; }
        .source-bar-label { font-size: 11px; color: #8b93a5; display: block; margin-top: 6px; }
        .source-note { font-size: 11px; color: #5a6070; margin-top: 14px; font-style: italic; }

        .advisory-panel, .healthcenter-panel { grid-column: 1 / -1; }

        .timeline { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }
        .timeline-item { display: flex; gap: 10px; align-items: flex-start; }
        .timeline-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; flex-shrink: 0; }
        .timeline-text { font-size: 12.5px; color: #d6dae4; line-height: 1.5; }
        .timeline-time { font-size: 10.5px; color: #6b7280; margin-top: 2px; }

        @media (max-width: 980px) {
          .grid { grid-template-columns: 1fr; }
          .kpi-row { grid-template-columns: repeat(2, 1fr); }
          .block-grid--boys, .block-grid--girls { grid-template-columns: repeat(4, 1fr); }
        }
        @media (max-width: 640px) {
          .topbar { padding: 14px 16px; }
          .topbar-title { font-size: 13px; }
          .kpi-row { grid-template-columns: 1fr 1fr; }
          .grid { padding: 16px; }
          .block-grid--boys, .block-grid--girls { grid-template-columns: repeat(3, 1fr); }
          .hc-grid { grid-template-columns: 1fr 1fr; }
        }

        .login-wrap {
          min-height: 100vh; display: flex; align-items: center; justify-content: center;
          background: radial-gradient(1200px 600px at 50% -10%, #131a29 0%, #0a0e16 55%), #0a0e16;
          padding: 24px;
          font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
        }
        .login-card {
          width: 100%; max-width: 380px; background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.08); border-radius: 18px; padding: 32px 28px;
          backdrop-filter: blur(10px);
        }
        .login-mark { color: #5b8cf0; font-size: 22px; text-align: center; margin-bottom: 8px; }
        .login-title { font-size: 17px; font-weight: 600; text-align: center; color: #f1f3f8; margin: 0 0 8px; letter-spacing: 0.03em; }
        .login-sub { font-size: 12.5px; color: #8b93a5; text-align: center; margin: 0 0 24px; line-height: 1.5; }
        .login-label { display: block; font-size: 11px; color: #8b93a5; margin-bottom: 6px; letter-spacing: 0.04em; text-transform: uppercase; }
        .login-input {
          width: 100%; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.12);
          color: #eef0f5; padding: 10px 12px; border-radius: 9px; font-size: 13px; margin-bottom: 16px;
          font-family: inherit;
        }
        .login-input:focus { outline: none; border-color: #5b8cf0; }
        .login-error { color: #f2606a; font-size: 12px; margin: -8px 0 14px; }
        .login-btn {
          width: 100%; background: #5b8cf0; color: #0a0e16; border: none; padding: 11px;
          border-radius: 9px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit;
        }
        .login-btn:hover { background: #6f9bf3; }
        .login-foot { font-size: 10.5px; color: #5a6070; text-align: center; margin-top: 18px; line-height: 1.5; }

        .report-wrap {
          min-height: 100vh; display: flex; align-items: flex-start; justify-content: center;
          background: radial-gradient(1200px 600px at 50% -10%, #131a29 0%, #0a0e16 55%), #0a0e16;
          padding: 32px 16px;
          font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
        }
        .report-card {
          width: 100%; max-width: 440px; background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.08); border-radius: 18px; padding: 26px 22px;
          backdrop-filter: blur(10px);
        }
        .report-card--success { text-align: center; }
        .success-icon {
          width: 44px; height: 44px; border-radius: 50%; background: rgba(95,214,148,0.12);
          color: #5fd694; border: 1px solid rgba(95,214,148,0.35); display: flex; align-items: center;
          justify-content: center; font-size: 20px; margin: 0 auto 14px;
        }
        .report-title { font-size: 18px; font-weight: 600; color: #f1f3f8; margin: 0 0 6px; letter-spacing: 0.01em; }
        .report-sub { font-size: 12.5px; color: #8b93a5; margin: 0 0 22px; line-height: 1.5; }
        .report-sub code { background: rgba(255,255,255,0.06); padding: 1px 6px; border-radius: 5px; font-size: 11.5px; color: #cdd3e0; }

        .field { margin-bottom: 18px; }
        .field-label { display: block; font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase; color: #8b93a5; margin-bottom: 8px; }
        .field-input {
          width: 100%; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.12);
          color: #eef0f5; padding: 11px 12px; border-radius: 9px; font-size: 14px; font-family: inherit;
          appearance: none;
        }
        .field-input:focus { outline: none; border-color: #5b8cf0; }
        .field-error { color: #f2606a; font-size: 11.5px; margin-top: 6px; }

        .chip-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
        .chip-grid--3 { grid-template-columns: repeat(3, 1fr); }
        .chip {
          background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.12);
          color: #cdd3e0; font-size: 12.5px; padding: 10px 8px; border-radius: 9px; cursor: pointer;
          font-family: inherit; transition: background 0.12s ease, border-color 0.12s ease;
        }
        .chip--active { background: rgba(91,140,240,0.16); border-color: #5b8cf0; color: #bcd0fb; }
        .chip--severity.chip--active { background: rgba(240,149,74,0.16); border-color: #f0954a; color: #f7c9a0; }

        .submit-error {
          background: rgba(242,96,106,0.1); border: 1px solid rgba(242,96,106,0.3);
          color: #f2a4ab; font-size: 12.5px; padding: 10px 12px; border-radius: 9px; margin-bottom: 16px;
        }

        .report-btn {
          width: 100%; background: #5b8cf0; color: #0a0e16; border: none; padding: 12px;
          border-radius: 9px; font-size: 13.5px; font-weight: 600; cursor: pointer; font-family: inherit;
        }
        .report-btn:hover { background: #6f9bf3; }
        .report-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .report-link {
          display: block; width: 100%; background: transparent; border: none; color: #8b93a5;
          font-size: 12px; margin-top: 12px; cursor: pointer; font-family: inherit; text-align: center;
        }
        .report-link:hover { color: #cdd3e0; }

        .sim-badge {
          font-size: 9.5px; letter-spacing: 0.06em; padding: 3px 8px; border-radius: 999px;
          background: rgba(240,149,74,0.12); color: #f0954a; border: 1px solid rgba(240,149,74,0.3);
          text-transform: uppercase; white-space: nowrap;
        }

        .advisory-list, .hc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
        .advisory-item {
          background: rgba(242,96,106,0.05); border: 1px solid rgba(242,96,106,0.2);
          border-radius: 12px; padding: 14px 16px;
        }
        .advisory-item-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
        .advisory-block { font-size: 13px; font-weight: 700; color: #eef0f5; }
        .advisory-severity { font-size: 10.5px; letter-spacing: 0.05em; font-weight: 600; }
        .advisory-message { font-size: 12.5px; color: #c3c8d4; line-height: 1.55; margin: 0 0 10px; }
        .advisory-meta { display: flex; justify-content: space-between; font-size: 11px; color: #8b93a5; }
        .advisory-status { color: #f0954a; font-weight: 600; letter-spacing: 0.04em; }

        .hc-item { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 14px 16px; }
        .hc-item-head { display: flex; justify-content: space-between; margin-bottom: 10px; }
        .hc-block { font-size: 13px; font-weight: 700; color: #eef0f5; }
        .hc-time { font-size: 11px; color: #6b7280; }
        .hc-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
        .hc-grid div { display: flex; flex-direction: column; gap: 3px; }
        .hc-grid span { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.05em; color: #8b93a5; }
        .hc-grid strong { font-size: 13px; color: #eef0f5; }
        .hc-evidence-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #8b93a5; }
        .hc-evidence ul { margin: 6px 0 0; padding-left: 16px; }
        .hc-evidence li { font-size: 12px; color: #c3c8d4; line-height: 1.6; }
        .hc-foot { font-size: 10.5px; color: #5a6070; font-style: italic; margin-top: 10px; }
      `}</style>
    </div>
  );
}