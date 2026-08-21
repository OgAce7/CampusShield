import React, { useState, useMemo, useCallback } from "react";

const BOYS = ["B01","B02","B03","B04","B05","B06","B07","B08","B09","B10","B11","B12"];
const GIRLS = ["G01","G02","G03","G04","G05","G06","G07","G08"];

const SYMPTOM_POOL = ["Nausea","Vomiting","Diarrhea","Fever","Cramps","Fatigue"];
const FOOD_POOL = ["MESS_A dinner","MESS_A lunch","MESS_B dinner","MESS_B lunch","OUTSIDE_FOOD"];

function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return function () {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function generateMockBlocks() {
  const rand = seededRandom(42);
  const outbreakBlocks = new Set(["B05", "B06", "B07", "B08"]);
  const all = [...BOYS.map((id) => ({ id, wing: "Boys" })), ...GIRLS.map((id) => ({ id, wing: "Girls" }))];

  return all.map(({ id, wing }) => {
    const isOutbreak = outbreakBlocks.has(id);
    const baseline = Math.round(8 + rand() * 6);
    let cases, casesToday, risk;

    if (isOutbreak) {
      cases = Math.round(28 + rand() * 22);
      casesToday = Math.round(9 + rand() * 8);
      risk = Math.round(66 + rand() * 32);
    } else {
      const noisy = rand() < 0.15;
      cases = Math.round(baseline * (noisy ? 1.8 : 1) + rand() * 4);
      casesToday = Math.round(1 + rand() * (noisy ? 6 : 3));
      risk = Math.round((cases / (baseline * 2.2)) * 55 + rand() * 12);
      risk = Math.min(risk, noisy ? 58 : 45);
    }
    risk = Math.max(3, Math.min(100, risk));

    const dominantSymptoms = isOutbreak
      ? ["Vomiting", "Diarrhea", "Cramps"]
      : [SYMPTOM_POOL[Math.floor(rand() * SYMPTOM_POOL.length)], SYMPTOM_POOL[Math.floor(rand() * SYMPTOM_POOL.length)]];

    const foodExposure = isOutbreak ? "MESS_A dinner" : FOOD_POOL[Math.floor(rand() * FOOD_POOL.length)];
    const exposureOverlap = isOutbreak ? Math.round(78 + rand() * 18) : Math.round(15 + rand() * 35);
    const onsetStart = isOutbreak ? 6 : Math.round(2 + rand() * 10);
    const onsetSpread = isOutbreak ? 4 : Math.round(6 + rand() * 10);

    return {
      id,
      wing,
      cases,
      casesToday,
      baseline,
      risk,
      dominantSymptoms: [...new Set(dominantSymptoms)],
      foodExposure,
      exposureOverlap,
      onsetWindow: `${onsetStart}h \u2013 ${onsetStart + onsetSpread}h post-meal`,
      isOutbreak,
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

const ALL_BLOCKS = [...BOYS, ...GIRLS];
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

const ALERTS = [
  { time: "Day 10, 19:40", text: "B05\u2013B08 risk crossed 80 (PROBABLE) \u2014 MESS_A dinner exposure overlap 91%", level: "red" },
  { time: "Day 10, 14:10", text: "B07 risk crossed 60 (SUSPECTED) \u2014 symptom cluster forming around vomiting/diarrhea", level: "orange" },
  { time: "Day 9, 21:05", text: "B06 flagged WATCH \u2014 cases 2.1x rolling baseline", level: "yellow" },
  { time: "Day 9, 08:15", text: "B05 first cluster reports logged, onset window narrowing", level: "yellow" },
  { time: "Day 6, 12:00", text: "System baseline recalibrated across all 20 blocks", level: "green" },
];

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
  const [blocks] = useState(generateMockBlocks);
  const [selectedId, setSelectedId] = useState(() => {
    const b = generateMockBlocks().find((b) => b.isOutbreak);
    return b ? b.id : null;
  });

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
      if (i >= 8) value = Math.round(30 + (i - 7) * 14 + rand() * 6);
      days.push({ label: `D${i}`, value, marker: i === 8 });
    }
    return days;
  }, []);

  const handleSelect = useCallback((id) => setSelectedId(id), []);

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
          <span className="session-info">{session.staffId} \u00B7 {session.role}</span>
          <button className="logout-btn" onClick={() => { setSession(null); setView("landing"); }}>Sign out</button>
        </div>
      </header>

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
          <ul className="timeline">
            {ALERTS.map((a, i) => (
              <li key={i} className="timeline-item">
                <span className="timeline-dot" style={{ background: COLORS[a.level].text }} />
                <div>
                  <div className="timeline-text">{a.text}</div>
                  <div className="timeline-time">{a.time}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
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
        }
        .topbar-left { display: flex; align-items: center; gap: 12px; }
        .topbar-mark { color: #5b8cf0; font-size: 18px; }
        .topbar-title { font-size: 15px; font-weight: 600; letter-spacing: 0.12em; }
        .topbar-pill {
          font-size: 10px; letter-spacing: 0.08em; padding: 3px 9px; border-radius: 999px;
          background: rgba(95,214,148,0.12); color: #5fd694; border: 1px solid rgba(95,214,148,0.3);
        }
        .topbar-right { display: flex; align-items: center; gap: 14px; }
        .session-info { font-size: 12px; color: #8b93a5; }
        .logout-btn {
          background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12);
          color: #cdd3e0; font-size: 12px; padding: 6px 12px; border-radius: 8px; cursor: pointer;
        }
        .logout-btn:hover { background: rgba(255,255,255,0.1); }

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

        .mess-row { display: flex; gap: 10px; padding: 10px 0; border-top: 1px dashed rgba(255,255,255,0.1); border-bottom: 1px dashed rgba(255,255,255,0.1); }
        .mess-node {
          flex: 1; background: rgba(91,140,240,0.08); border: 1px solid rgba(91,140,240,0.25);
          border-radius: 10px; padding: 10px; text-align: center;
        }
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
      `}</style>
    </div>
  );
}