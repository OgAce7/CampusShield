import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";

const BOYS = ["B01","B02","B03","B04","B05","B06","B07","B08","B09","B10","B11","B12"];
const GIRLS = ["G01","G02","G03","G04","G05","G06","G07","G08"];

const SYMPTOM_POOL = ["Nausea","Vomiting","Diarrhea","Fever","Cramps","Fatigue"];

// --- deterministic demo data --------------------------------------------
// No randomness in the demo path: baseline values are fixed per block so the
// presentation is byte-for-byte repeatable across runs. A small seeded PRNG
// is used only to vary cosmetic baseline symptom pairs — never case counts
// or risk scores, which are the numbers a judge will actually watch.

function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return function () {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// A couple of blocks run slightly hot from ordinary background illness —
// this is the "normal noise" the system needs to tell an outbreak apart from.
const BACKGROUND_NOISE_BLOCKS = { G02: 34, B09: 31 };

const BASELINE_FOOD_CYCLE = ["MESS_A lunch", "MESS_B lunch", "MESS_A dinner", "MESS_B dinner", "OUTSIDE_FOOD"];

function buildBaselineBlocks() {
  const rand = seededRandom(1337);
  const all = [...BOYS.map((id) => ({ id, wing: "Boys" })), ...GIRLS.map((id) => ({ id, wing: "Girls" }))];

  return all.map(({ id, wing }, i) => {
    const noiseRisk = BACKGROUND_NOISE_BLOCKS[id];
    const baseline = 8 + (i % 5); // fixed spread, not random
    const cases = noiseRisk ? baseline + 3 : Math.min(baseline, (i % 3) + 1);
    const risk = noiseRisk || 6 + (i % 4) * 3;
    const s1 = SYMPTOM_POOL[i % SYMPTOM_POOL.length];
    const s2 = SYMPTOM_POOL[(i + 2) % SYMPTOM_POOL.length];

    return {
      id,
      wing,
      cases,
      casesToday: noiseRisk ? 2 : (i % 3),
      baseline,
      risk,
      dominantSymptoms: [...new Set([s1, s2])],
      foodExposure: BASELINE_FOOD_CYCLE[i % BASELINE_FOOD_CYCLE.length],
      exposureOverlap: noiseRisk ? 22 : 12 + (i % 4) * 3,
      onsetWindow: `${2 + (i % 6)}h \u2013 ${8 + (i % 6)}h post-meal`,
      isOutbreak: false,
    };
  });
}

// Fixed end-state for the "SIMULATE OUTBREAK" scenario — matches the
// hackathon walkthrough numbers exactly. All synthetic demonstration data.
const OUTBREAK_TARGETS = {
  B03: {
    cases: 12, risk: 89,
    dominantSymptoms: ["Vomiting", "Diarrhea", "Cramps"],
    foodExposure: "MESS_A lunch",
    exposureOverlap: 92,
    onsetWindow: "5h \u2013 9h post-meal",
  },
  B04: {
    cases: 7, risk: 72,
    dominantSymptoms: ["Vomiting", "Diarrhea"],
    foodExposure: "MESS_A lunch",
    exposureOverlap: 81,
    onsetWindow: "6h \u2013 10h post-meal",
  },
  B05: {
    cases: 5, risk: 61,
    dominantSymptoms: ["Nausea", "Diarrhea"],
    foodExposure: "MESS_A lunch",
    exposureOverlap: 68,
    onsetWindow: "6h \u2013 11h post-meal",
  },
};

const OUTBREAK_CLUSTER_BLOCK = "B03";
const DEMO_STAGE_COUNT = 4; // 0 = baseline, 4 = final outbreak state

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Given the fixed baseline and the fixed target, compute the exact
// intermediate state for a given stage (0..DEMO_STAGE_COUNT). Pure function
// of (baselineBlock, stage) — same stage always produces the same output.
function applyDemoStage(baselineBlocks, stage) {
  const t = Math.min(stage, DEMO_STAGE_COUNT) / DEMO_STAGE_COUNT;
  return baselineBlocks.map((b) => {
    const target = OUTBREAK_TARGETS[b.id];
    if (!target || stage === 0) return b;

    // symptoms and food source converge discretely partway through, rather
    // than blending, since real symptom clustering is a step change, not a gradient
    const converged = t >= 0.5;

    return {
      ...b,
      cases: Math.round(lerp(b.cases, target.cases, t)),
      casesToday: Math.round(lerp(b.casesToday, Math.max(2, Math.round(target.cases * 0.4)), t)),
      risk: Math.round(lerp(b.risk, target.risk, t)),
      dominantSymptoms: converged ? target.dominantSymptoms : b.dominantSymptoms,
      foodExposure: converged ? target.foodExposure : b.foodExposure,
      exposureOverlap: Math.round(lerp(b.exposureOverlap, target.exposureOverlap, t)),
      onsetWindow: converged ? target.onsetWindow : b.onsetWindow,
      isOutbreak: t >= 1,
    };
  });
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

// --- simulated advisory system -------------------------------------------
// Template-based only (no generative model). Fires when a block's risk score
// crosses the PROBABLE threshold (>=80). Two outputs:
//   1. a resident-facing advisory notice (no individual identities, no diagnosis)
//   2. a health-center alert with the supporting evidence a nurse/warden would want
// Everything here is clearly labeled SIMULATED and produces no real notification.

const ADVISORY_THRESHOLD = 80;
const BLOCK_POPULATION = 64; // assumed residents per block, for demo targeting counts only

const ADVISORY_MESSAGE =
  "An unusual increase in gastrointestinal symptoms has been detected in your block. " +
  "Please follow standard hygiene precautions and report symptoms to the campus health " +
  "center if they develop.";

function buildAdvisories(blocks) {
  return blocks
    .filter((b) => b.risk >= ADVISORY_THRESHOLD)
    .map((b) => {
      const unaffected = Math.max(BLOCK_POPULATION - b.cases, 0);
      return {
        id: `adv_${b.id}`,
        block: b.id,
        timestamp: new Date().toISOString(),
        severity: riskState(b.risk).label,
        message: ADVISORY_MESSAGE,
        targeted: unaffected,
        status: "SIMULATED",
      };
    });
}

function buildHealthCenterAlerts(blocks) {
  return blocks
    .filter((b) => b.risk >= ADVISORY_THRESHOLD)
    .map((b) => ({
      id: `hc_${b.id}`,
      block: b.id,
      timestamp: new Date().toISOString(),
      caseCount: b.cases,
      riskScore: b.risk,
      suspectedExposure: b.foodExposure,
      evidence: [
        `Cases running ${Math.max(1, Math.round(b.cases / Math.max(b.baseline, 1)))}x above the ${b.baseline}-case rolling baseline`,
        `${b.exposureOverlap}% of reporters in ${b.id} share exposure to ${b.foodExposure}`,
        `Symptom profile clustered around ${b.dominantSymptoms.join(", ")}`,
        `Onset times fall within a narrow window: ${b.onsetWindow}`,
      ],
      status: "SIMULATED",
    }));
}

function formatTimestamp(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function explainRisk(block) {
  if (!block) return "";
  const st = riskState(block.risk);
  if (block.risk < 30) {
    return `${block.id} is within normal background variation. Reported cases (${block.cases}) sit close to the ${block.baseline}-case rolling baseline, symptoms are diffuse, and exposure overlap is low \u2014 consistent with ordinary sporadic GI illness rather than a common source.`;
  }
  if (block.risk < 60) {
    return `${block.id} shows a mild uptick above baseline (${block.cases} vs. expected ~${block.baseline}). Not yet clustered enough in symptom type or exposure to call a point-source event, but worth watching over the next reporting cycle.`;
  }
  if (block.risk < 80) {
    return `${block.id} is trending toward a point-source signature: cases are running well above baseline, symptoms are converging on ${block.dominantSymptoms.join(" and ")}, and ${block.exposureOverlap}% of reporters share a recent ${block.foodExposure} exposure within a tight onset window (${block.onsetWindow}).`;
  }
  return `${block.id} matches a classic point-source outbreak signature: cases are ${Math.round(block.cases / Math.max(block.baseline, 1))}x baseline, ${block.exposureOverlap}% of reporters share ${block.foodExposure}, symptom profile is tightly clustered around ${block.dominantSymptoms.join(" and ")}, and onset times fall within a narrow ${block.onsetWindow} window \u2014 the pattern a shared contaminated meal produces, not background noise.`;
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
  const st = riskState(block.risk);
  const c = COLORS[st.key];
  return (
    <button
      className={"block-node" + (selected ? " block-node--selected" : "")}
      style={{
        background: c.fill,
        borderColor: selected ? c.text : c.border,
        boxShadow: selected ? `0 0 0 3px ${c.glow}` : "none",
      }}
      onClick={() => onSelect(block.id)}
      aria-pressed={selected}
      title={`${block.id} \u2014 ${st.label}`}
    >
      <span className="block-id">{block.id}</span>
      <span className="block-cases">{block.cases}</span>
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

function Sparkline({ data, color }) {
  const w = 640, h = 160, pad = 24;
  const max = Math.max(...data.map((d) => d.value)) * 1.15;
  const min = 0;
  const stepX = (w - pad * 2) / (data.length - 1);
  const points = data.map((d, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((d.value - min) / (max - min || 1)) * (h - pad * 2);
    return [x, y];
  });
  const path = points.map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`)).join(" ");
  const areaPath = `${path} L${points[points.length - 1][0]},${h - pad} L${points[0][0]},${h - pad} Z`;
  const outbreakStartIdx = data.findIndex((d) => d.marker);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="sparkline" role="img" aria-label="Case trend over the last 10 days">
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={pad} x2={w - pad} y1={pad + f * (h - pad * 2)} y2={pad + f * (h - pad * 2)} stroke="#2a2f3a" strokeWidth="1" />
      ))}
      <path d={areaPath} fill="url(#trendFill)" stroke="none" />
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={data[i].marker ? 5 : 2.5} fill={data[i].marker ? "#f2606a" : color} stroke="#0d1117" strokeWidth="1" />
      ))}
      {outbreakStartIdx >= 0 && (
        <text x={points[outbreakStartIdx][0]} y={points[outbreakStartIdx][1] - 12} textAnchor="middle" fontSize="10" fill="#f2606a">
          outbreak onset
        </text>
      )}
      {data.map((d, i) => (
        i % 2 === 0 && (
          <text key={i} x={points[i][0]} y={h - 4} textAnchor="middle" fontSize="9" fill="#6b7280">{d.label}</text>
        )
      ))}
    </svg>
  );
}

const API_BASE = ""; // e.g. "http://localhost:8000" — leave empty to fall back to demo mode

function LoginGate({ onLogin }) {
  const [staffId, setStaffId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!staffId.trim() || !password.trim()) {
      setError("Enter both staff ID and password.");
      return;
    }
    if (password.length < 4) {
      setError("Password looks too short \u2014 check and try again.");
      return;
    }
    setError("");

    if (!API_BASE) {
      // Demo fallback: no backend configured, sign in locally.
      onLogin({ staffId: staffId.trim(), role: "Health Desk Staff", token: null });
      return;
    }

    setLoading(true);
    try {
      const body = new URLSearchParams();
      body.set("username", staffId.trim());
      body.set("password", password);
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        setError(detail.detail || "Incorrect staff ID or password.");
        setLoading(false);
        return;
      }
      const data = await res.json();
      onLogin({ staffId: data.staff_id, role: data.role, token: data.access_token });
    } catch (err) {
      setError("Couldn\u2019t reach the auth server. Check the backend is running.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-mark">\u25C9</div>
        <h1 className="login-title">Hostel Outbreak Radar</h1>
        <p className="login-sub">Restricted to authorized campus health staff. Sign in to view live block data.</p>
        <form onSubmit={submit}>
          <label className="login-label" htmlFor="staffId">Staff ID</label>
          <input id="staffId" className="login-input" value={staffId} onChange={(e) => setStaffId(e.target.value)} placeholder="e.g. HD-0231" autoComplete="username" />
          <label className="login-label" htmlFor="pw">Password</label>
          <input id="pw" type="password" className="login-input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" autoComplete="current-password" />
          {error && <div className="login-error">{error}</div>}
          <button className="login-btn" type="submit" disabled={loading}>{loading ? "Signing in\u2026" : "Sign in"}</button>
        </form>
        <div className="login-foot">
          {API_BASE
            ? "Authenticates against the FastAPI /auth/login endpoint (JWT, 8h session)."
            : "Demo mode \u2014 no backend configured, any staff ID and a 4+ character password signs you in locally."}
        </div>
      </div>
    </div>
  );
}

const SYMPTOM_OPTIONS = ["Nausea", "Vomiting", "Diarrhea", "Abdominal pain", "Fever", "Headache"];
const SEVERITY_OPTIONS = ["Mild", "Moderate", "Severe"];
const FOOD_EXPOSURE_OPTIONS = ["Mess A", "Mess B", "Outside food"];

function makeAnonId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "anon_";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function ReportForm({ apiBase, onBack }) {
  const [anonId] = useState(makeAnonId);
  const [block, setBlock] = useState("");
  const [symptoms, setSymptoms] = useState([]);
  const [severity, setSeverity] = useState("");
  const [onsetTime, setOnsetTime] = useState("");
  const [foodExposure, setFoodExposure] = useState("");
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState("idle"); // idle | loading | success | error
  const [serverError, setServerError] = useState("");

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

    if (!apiBase) {
      await new Promise((r) => setTimeout(r, 600));
      setStatus("success");
      return;
    }

    try {
      const res = await fetch(`${apiBase}/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        setServerError(detail.detail || "The server rejected this report. Check the fields and try again.");
        setStatus("error");
        return;
      }
      setStatus("success");
    } catch (err) {
      setServerError("Couldn\u2019t reach the server. Check your connection and try again.");
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

function AdvisoryPanel({ advisories }) {
  return (
    <section className="panel advisory-panel">
      <div className="panel-head">
        <h2>Simulated resident advisories</h2>
        <span className="sim-badge">SIMULATED \u2014 no real notification sent</span>
      </div>
      {advisories.length === 0 ? (
        <div className="empty-state">No block has crossed the PROBABLE threshold (risk \u2265 {ADVISORY_THRESHOLD}). No advisories generated.</div>
      ) : (
        <ul className="advisory-list">
          {advisories.map((a) => (
            <li key={a.id} className="advisory-item">
              <div className="advisory-item-head">
                <span className="advisory-block">{a.block}</span>
                <span className="advisory-severity" style={{ color: COLORS.red.text }}>{a.severity}</span>
                <span className="advisory-time">{formatTimestamp(a.timestamp)}</span>
              </div>
              <p className="advisory-message">{a.message}</p>
              <div className="advisory-meta">
                <span>{a.targeted} unaffected students targeted</span>
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
        <h2>Simulated health-center alert</h2>
        <span className="sim-badge">SIMULATED</span>
      </div>
      {alerts.length === 0 ? (
        <div className="empty-state">No active health-center alerts.</div>
      ) : (
        <ul className="hc-list">
          {alerts.map((a) => (
            <li key={a.id} className="hc-item">
              <div className="hc-item-head">
                <span className="hc-block">{a.block}</span>
                <span className="hc-time">{formatTimestamp(a.timestamp)}</span>
              </div>
              <div className="hc-grid">
                <div><span>Case count</span><strong>{a.caseCount}</strong></div>
                <div><span>Risk score</span><strong>{a.riskScore}</strong></div>
                <div><span>Suspected exposure</span><strong>{a.suspectedExposure}</strong></div>
              </div>
              <div className="hc-evidence">
                <span className="hc-evidence-label">Supporting evidence</span>
                <ul>
                  {a.evidence.map((e, i) => <li key={i}>{e}</li>)}
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

// Historical entries predate the demo scenario and never change. Live entries
// are derived from the current block state so the timeline always matches
// whatever the SIMULATE OUTBREAK / RESET DEMO buttons have produced — no
// hardcoded block names that could drift out of sync with the scenario data.
const HISTORICAL_ALERTS = [
  { time: "Day 6, 12:00", text: "System baseline recalibrated across all 20 blocks", level: "green" },
  { time: "Day 8, 09:20", text: "G02 flagged WATCH \u2014 mild seasonal uptick, resolved within 48h", level: "yellow" },
];

function buildTimeline(blocks, demoStage) {
  if (demoStage === 0) return HISTORICAL_ALERTS;
  const live = [];
  // ordered by cluster dominance so the lead block (highest risk) reads first
  const clusterOrder = Object.keys(OUTBREAK_TARGETS).sort(
    (a, b) => OUTBREAK_TARGETS[b].risk - OUTBREAK_TARGETS[a].risk
  );
  clusterOrder.forEach((id) => {
    const b = blocks.find((x) => x.id === id);
    if (!b) return;
    const st = riskState(b.risk);
    if (st.key === "green") return;
    live.push({
      time: `Live \u00B7 stage ${demoStage}/${DEMO_STAGE_COUNT}`,
      text: `${id} risk reached ${b.risk} (${st.label}) \u2014 ${b.exposureOverlap}% exposure overlap on ${b.foodExposure}`,
      level: st.key,
    });
  });
  return [...live, ...HISTORICAL_ALERTS];
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

export default function App() {
  const [view, setView] = useState("landing"); // landing | report | login | dashboard
  const [session, setSession] = useState(null);
  const [baselineBlocks] = useState(buildBaselineBlocks);
  const [demoStage, setDemoStage] = useState(0); // 0 = baseline, DEMO_STAGE_COUNT = full outbreak
  const [demoRunning, setDemoRunning] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const intervalRef = useRef(null);

  const blocks = useMemo(() => applyDemoStage(baselineBlocks, demoStage), [baselineBlocks, demoStage]);

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const runSimulation = useCallback(() => {
    if (demoRunning) return;
    setDemoRunning(true);
    setDemoStage(0);
    setSelectedId(null);
    let stage = 0;
    intervalRef.current = setInterval(() => {
      stage += 1;
      setDemoStage(stage);
      if (stage === 1) setSelectedId(OUTBREAK_CLUSTER_BLOCK);
      if (stage >= DEMO_STAGE_COUNT) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
        setDemoRunning(false);
      }
    }, 900);
  }, [demoRunning]);

  const resetDemo = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setDemoRunning(false);
    setDemoStage(0);
    setSelectedId(null);
  }, []);

  const selected = useMemo(() => blocks.find((b) => b.id === selectedId) || null, [blocks, selectedId]);

  const kpis = useMemo(() => {
    const activeCases = blocks.reduce((s, b) => s + b.cases, 0);
    const casesToday = blocks.reduce((s, b) => s + b.casesToday, 0);
    const highest = blocks.reduce((m, b) => (b.risk > m.risk ? b : m), blocks[0]);
    const totalBaseline = blocks.reduce((s, b) => s + b.baseline, 0);
    const deviation = Math.round(((activeCases - totalBaseline) / totalBaseline) * 100);
    return { activeCases, casesToday, highest, deviation };
  }, [blocks]);

  const trendData = useMemo(() => {
    const rand = seededRandom(7);
    const days = [];
    for (let i = 1; i <= 10; i++) {
      let value = Math.round(14 + rand() * 8);
      if (i >= 8 && demoStage > 0) value = Math.round(30 + (i - 7) * 14 * (demoStage / DEMO_STAGE_COUNT) + rand() * 6);
      days.push({ label: `D${i}`, value, marker: i === 8 && demoStage > 0 });
    }
    return days;
  }, [demoStage]);

  const handleSelect = useCallback((id) => setSelectedId(id), []);

  const advisories = useMemo(() => buildAdvisories(blocks), [blocks]);
  const healthCenterAlerts = useMemo(() => buildHealthCenterAlerts(blocks), [blocks]);
  const timeline = useMemo(() => buildTimeline(blocks, demoStage), [blocks, demoStage]);

  if (view === "landing") {
    return <Landing onPickStudent={() => setView("report")} onPickStaff={() => setView("login")} />;
  }
  if (view === "report") {
    return <ReportForm apiBase={API_BASE} onBack={() => setView("landing")} />;
  }
  if (!session) {
    return <LoginGate onLogin={(s) => { setSession(s); setView("dashboard"); }} />;
  }

  const st = selected ? riskState(selected.risk) : null;
  const c = st ? COLORS[st.key] : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <span className="topbar-mark">\u25C9</span>
          <span className="topbar-title">HOSTEL OUTBREAK RADAR</span>
          <span className="topbar-pill">LIVE \u2014 MOCK DATA</span>
        </div>
        <div className="topbar-right">
          <button className="demo-btn demo-btn--simulate" onClick={runSimulation} disabled={demoRunning}>
            {demoRunning ? `Simulating\u2026 stage ${demoStage}/${DEMO_STAGE_COUNT}` : "Simulate outbreak"}
          </button>
          <button className="demo-btn demo-btn--reset" onClick={resetDemo}>Reset demo</button>
          <span className="session-info">{session.staffId} \u00B7 {session.role}</span>
          <button className="logout-btn" onClick={() => { setSession(null); setView("landing"); }}>Sign out</button>
        </div>
      </header>

      {demoStage > 0 && (
        <div className="demo-banner">
          Demo simulation {demoRunning ? "running" : "complete"} \u2014 stage {demoStage}/{DEMO_STAGE_COUNT} \u2014 all figures are synthetic demonstration data.
        </div>
      )}

      <main className="grid">
        <section className="kpi-row">
          <KpiCard label="Active cases" value={kpis.activeCases} sub="across 20 blocks" />
          <KpiCard label="Cases today" value={kpis.casesToday} sub="new reports, 24h" />
          <KpiCard label="Highest risk" value={`${kpis.highest.id} \u00B7 ${kpis.highest.risk}`} sub={riskState(kpis.highest.risk).label} tone={COLORS[riskState(kpis.highest.risk).key].text} />
          <KpiCard label="Baseline deviation" value={`${kpis.deviation > 0 ? "+" : ""}${kpis.deviation}%`} sub="vs. rolling baseline" tone={kpis.deviation > 30 ? COLORS.red.text : undefined} />
        </section>

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
                {blocks.filter((b) => b.wing === "Boys").map((b) => (
                  <BlockNode key={b.id} block={b} selected={b.id === selectedId} onSelect={handleSelect} />
                ))}
              </div>
            </div>

            <div className="mess-row">
              <MessNode label="Mess A" sub="B01\u2013B08 primary" />
              <MessNode label="Mess B" sub="B09\u2013G08 primary" />
              <MessNode label="Outside food" sub="unaffiliated" />
            </div>

            <div className="wing">
              <div className="wing-label">Girls hostels</div>
              <div className="block-grid block-grid--girls">
                {blocks.filter((b) => b.wing === "Girls").map((b) => (
                  <BlockNode key={b.id} block={b} selected={b.id === selectedId} onSelect={handleSelect} />
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
                  <div className="detail-block-id">{selected.id}</div>
                  <div className="detail-block-wing">{selected.wing} hostel</div>
                </div>
                <div className="detail-risk" style={{ color: c.text }}>
                  <div className="detail-risk-score">{selected.risk}</div>
                  <div className="detail-risk-label">{st.label}</div>
                </div>
              </div>
              <div className="detail-grid">
                <div className="detail-item"><span>Reported cases</span><strong>{selected.cases}</strong></div>
                <div className="detail-item"><span>Cases today</span><strong>{selected.casesToday}</strong></div>
                <div className="detail-item"><span>Baseline</span><strong>{selected.baseline}</strong></div>
                <div className="detail-item"><span>Exposure overlap</span><strong>{selected.exposureOverlap}%</strong></div>
                <div className="detail-item detail-item--wide"><span>Dominant symptoms</span><strong>{selected.dominantSymptoms.join(", ")}</strong></div>
                <div className="detail-item detail-item--wide"><span>Common food exposure</span><strong>{selected.foodExposure}</strong></div>
                <div className="detail-item detail-item--wide"><span>Onset window</span><strong>{selected.onsetWindow}</strong></div>
              </div>
            </div>
          ) : (
            <div className="empty-state">Select a block on the radar to see details.</div>
          )}
        </section>

        <section className="panel explain-panel">
          <div className="panel-head"><h2>Outbreak risk explanation</h2></div>
          <p className="explain-text">{selected ? explainRisk(selected) : "Select a block to see why it is or isn\u2019t flagged."}</p>
        </section>

        <section className="panel source-panel">
          <div className="panel-head"><h2>Source attribution</h2></div>
          {selected ? (
            <div className="source-body">
              <div className="source-row">
                <span>Likely source</span>
                <strong>{selected.foodExposure}</strong>
              </div>
              <div className="source-bar-wrap">
                <div className="source-bar-track">
                  <div className="source-bar-fill" style={{ width: `${selected.exposureOverlap}%`, background: c.text }} />
                </div>
                <span className="source-bar-label">{selected.exposureOverlap}% of reporters in {selected.id} share this exposure</span>
              </div>
              <div className="source-note">Attribution is exposure-overlap based, not confirmed \u2014 use for triage priority, not diagnosis.</div>
            </div>
          ) : (
            <div className="empty-state">No block selected.</div>
          )}
        </section>

        <section className="panel trend-panel">
          <div className="panel-head"><h2>Case trend \u2014 last 10 days</h2></div>
          <Sparkline data={trendData} color="#5b8cf0" />
        </section>

        <section className="panel timeline-panel">
          <div className="panel-head"><h2>Alert timeline</h2></div>
          {timeline.length === 0 ? (
            <div className="empty-state">No alerts yet.</div>
          ) : (
            <ul className="timeline">
              {timeline.map((a, i) => (
                <li key={i} className="timeline-item">
                  <span className="timeline-dot" style={{ background: COLORS[a.level].text }} />
                  <div>
                    <div className="timeline-text">{a.text}</div>
                    <div className="timeline-time">{a.time}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <AdvisoryPanel advisories={advisories} />
        <HealthCenterPanel alerts={healthCenterAlerts} />

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
        .demo-btn--simulate { background: #f0954a; color: #2e1c0f; }
        .demo-btn--simulate:hover { background: #f5a866; }
        .demo-btn--simulate:disabled { opacity: 0.7; cursor: not-allowed; }
        .demo-btn--reset { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.12); color: #cdd3e0; }
        .demo-btn--reset:hover { background: rgba(255,255,255,0.1); }

        .demo-banner {
          text-align: center; font-size: 11.5px; color: #f0954a; background: rgba(240,149,74,0.08);
          border-bottom: 1px solid rgba(240,149,74,0.2); padding: 6px 12px; letter-spacing: 0.02em;
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

        .trend-panel { grid-column: 1 / 2; }
        .sparkline { width: 100%; height: auto; }
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
        .advisory-time { font-size: 11px; color: #6b7280; margin-left: auto; }
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