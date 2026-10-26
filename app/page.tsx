"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import LandingPage from "../components/LandingPage";

type Tracker = {
  name: string;
  short: string;
  detail: string;
  tone: string;
  selected: boolean;
};
type Session = {
  id: string;
  filename: string;
  frames: number;
  fps: number;
  width: number;
  height: number;
  has_ground_truth?: boolean;
};
type Result = {
  tracker: string;
  fps: number | null;
  precision: number | null;
  success_auc: number | null;
  status: string;
  trajectory: number[][];
  note?: string;
  num_frames_processed?: number;
  failures?: number;
};
type HistorySession = Session & {
  created_at: string;
  trackers?: string[];
  results?: Result[];
  summary?: { average_fps: number; frames_analyzed: number };
};

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "https://visual-tracker-llls.onrender.com";
const initialTrackers: Tracker[] = [
  {
    name: "CSRT",
    short: "Channel & spatial reliability",
    detail: "Robust to deformation and scale change",
    tone: "purple",
    selected: true,
  },
  {
    name: "KCF",
    short: "Kernelized correlation filter",
    detail: "Fast, reliable baseline",
    tone: "blue",
    selected: true,
  },
  {
    name: "MOSSE",
    short: "Minimum output sum filter",
    detail: "Ultra-fast, lightweight baseline",
    tone: "orange",
    selected: true,
  },
  {
    name: "GOTURN",
    short: "Deep regression network",
    detail: "Learns complex motion patterns",
    tone: "green",
    selected: false,
  },
];

export default function Home() {
  const [token, setToken] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [showAuth, setShowAuth] = useState(false);
  const [activeView, setActiveView] = useState<
    "workspace" | "sessions" | "benchmarks"
  >("workspace");
  const [history, setHistory] = useState<HistorySession[]>([]);
  const [trackers, setTrackers] = useState(initialTrackers);
  const [session, setSession] = useState<Session | null>(null);
  const [bbox, setBbox] = useState({ x: 120, y: 95, width: 180, height: 150 });
  const [file, setFile] = useState<File | null>(null);
  const [gtFile, setGtFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    "Upload a video to begin a tracking session.",
  );
  const [results, setResults] = useState<Result[]>([]);
  const [benchmarks, setBenchmarks] = useState<{
    average_fps: number;
    frames_analyzed: number;
  } | null>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const selectedCount = useMemo(
    () => trackers.filter((tracker) => tracker.selected).length,
    [trackers],
  );

  useEffect(() => {
    const savedToken = localStorage.getItem("vts_token");
    if (savedToken) setToken(savedToken);
  }, []);

  useEffect(() => {
    if (!isPlaying || !session) return;
    const interval = setInterval(
      () => {
        setCurrentFrame((prev) => {
          if (prev >= session.frames - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      },
      1000 / (session.fps || 30),
    );
    return () => clearInterval(interval);
  }, [isPlaying, session]);

  function logout() {
    localStorage.removeItem("vts_token");
    setToken(null);
    setHistory([]);
    setSession(null);
    setResults([]);
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    setBusy(true);
    try {
      if (authMode === "register") {
        const res = await fetch(`${API_URL}/api/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password }),
        });
        if (!res.ok)
          throw new Error((await res.json()).detail || "Registration failed");
        setAuthMode("login");
        setAuthError("Registration successful. Please log in.");
      } else {
        const formData = new URLSearchParams();
        formData.append("username", email);
        formData.append("password", password);
        const res = await fetch(`${API_URL}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: formData,
        });
        if (!res.ok) throw new Error("Invalid credentials");
        const data = await res.json();
        localStorage.setItem("vts_token", data.access_token);
        setToken(data.access_token);
      }
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function fetchHistory() {
    try {
      const res = await fetch(`${API_URL}/api/sessions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setHistory(await res.json());
    } catch (err) {
      console.error("Failed to load history", err);
    }
  }

  function handleNavigation(view: "workspace" | "sessions" | "benchmarks") {
    setActiveView(view);
    if (view !== "workspace") fetchHistory();
  }

  async function handleUploads(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setMessage("Please select a video file first.");
    setBusy(true);
    setMessage("Reading video metadata and uploading files...");

    const form = new FormData();
    form.append("file", file);
    if (gtFile) form.append("gt_file", gtFile);

    try {
      const response = await fetch(`${API_URL}/api/sessions`, {
        method: "POST",
        body: form,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      setSession(data);
      setResults([]);
      setCurrentFrame(0);
      setMessage(
        data.has_ground_truth
          ? "Video & Ground Truth verified. Ready for academic evaluation."
          : "Video ready. (No Ground Truth provided - accuracy metrics will be skipped).",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to connect to backend.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function runComparison() {
    if (!session) return setMessage("Upload a video before starting.");
    if (!selectedCount) return setMessage("Select at least one tracker.");
    if (bbox.x < 0 || bbox.y < 0)
      return setMessage("X and Y coordinates cannot be negative.");
    if (bbox.width < 10 || bbox.height < 10)
      return setMessage("Target box must be at least 10px wide.");
    if (bbox.x >= session.width || bbox.y >= session.height)
      return setMessage("Coordinates are out of bounds.");
    if (
      bbox.x + bbox.width > session.width ||
      bbox.y + bbox.height > session.height
    )
      return setMessage("Box goes off-screen.");

    setBusy(true);
    setIsPlaying(false);
    setCurrentFrame(0);
    setMessage("Running tracking engines and extracting trajectories...");
    try {
      const response = await fetch(
        `${API_URL}/api/sessions/${session.id}/track`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            bbox,
            trackers: trackers
              .filter((tracker) => tracker.selected)
              .map((tracker) => tracker.name),
          }),
        },
      );
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      setResults(payload.results);
      setBenchmarks(payload.benchmarks ?? null);
      setMessage("Analysis complete. Review the performance snapshot below.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Comparison failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <LandingPage
        showAuth={showAuth}
        authMode={authMode}
        name={name}
        email={email}
        password={password}
        authError={authError}
        busy={busy}
        onOpenAuth={(mode) => {
          setAuthMode(mode);
          setAuthError("");
          setShowAuth(true);
        }}
        onCloseAuth={() => {
          setShowAuth(false);
          setAuthError("");
        }}
        onNameChange={setName}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onModeChange={(mode) => {
          setAuthMode(mode);
          setAuthError("");
        }}
        onSubmit={handleAuth}
      />
    );
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">V</span>
          <span>
            VisualTracker <b>Studio</b>
          </span>
        </div>
        <nav>
          <a
            className={activeView === "workspace" ? "active" : ""}
            onClick={() => handleNavigation("workspace")}
            style={{ cursor: "pointer" }}
          >
            <span>◈</span> Workspace
          </a>
          <a
            className={activeView === "sessions" ? "active" : ""}
            onClick={() => handleNavigation("sessions")}
            style={{ cursor: "pointer" }}
          >
            <span>◷</span> Sessions
          </a>
          <a
            className={activeView === "benchmarks" ? "active" : ""}
            onClick={() => handleNavigation("benchmarks")}
            style={{ cursor: "pointer" }}
          >
            <span>▦</span> Benchmarks
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="status-dot" /> Authenticated
          <button
            onClick={logout}
            className="ghost-button"
            style={{
              marginTop: "10px",
              width: "100%",
              justifyContent: "center",
              padding: "6px",
            }}
          >
            Sign Out
          </button>
        </div>
      </aside>

      <section
        className="content"
        style={{ width: "100%", maxWidth: "1400px" }}
      >
        <header className="topbar">
          <div>
            <p className="eyebrow">RESEARCH WORKSPACE / SINGLE OBJECT</p>
            <h1>
              {activeView === "workspace"
                ? "Compare trackers"
                : activeView === "sessions"
                  ? "Session History"
                  : "Global Benchmarks"}
            </h1>
          </div>
          <button className="ghost-button">Documentation ↗</button>
        </header>

        {activeView === "workspace" && (
          <>
            <div className="notice">
              <span>✦</span>
              <span>{message}</span>
            </div>
            <div className="workspace-grid" id="workspace">
              {/* UPDATED UPLOAD CARD WITH GROUND TRUTH */}
              <section className="card upload-card" style={{ width: "100%" }}>
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">01 / SOURCE DATA</p>
                    <h2>Upload sequence & GT</h2>
                  </div>
                  <span className="step">01</span>
                </div>
                <form onSubmit={handleUploads}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "1rem",
                      marginBottom: "1rem",
                    }}
                  >
                    <label className="dropzone" style={{ minHeight: "120px" }}>
                      <input
                        type="file"
                        accept="video/*"
                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                      />
                      <span className="upload-icon">↑</span>
                      <strong>
                        {file ? file.name : "1. Select Video (.mp4)"}
                      </strong>
                    </label>
                    <label className="dropzone" style={{ minHeight: "120px" }}>
                      <input
                        type="file"
                        accept=".txt"
                        onChange={(e) => setGtFile(e.target.files?.[0] || null)}
                      />
                      <span className="upload-icon">≡</span>
                      <strong>
                        {gtFile ? gtFile.name : "2. Select Ground Truth (.txt)"}
                      </strong>
                    </label>
                  </div>
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={busy}
                    style={{ width: "100%", justifyContent: "center" }}
                  >
                    {busy ? "Uploading..." : "Confirm Uploads"}
                  </button>
                </form>
                {session && (
                  <div className="video-meta" style={{ marginTop: "1rem" }}>
                    <span>
                      <b>
                        {session.width}×{session.height}
                      </b>{" "}
                      res
                    </span>
                    <span>
                      <b>{session.frames}</b> frames
                    </span>
                    <span
                      style={{
                        color: session.has_ground_truth
                          ? "var(--green)"
                          : "#888",
                      }}
                    >
                      <b>
                        {session.has_ground_truth
                          ? "Ground Truth Linked"
                          : "No GT Data"}
                      </b>
                    </span>
                  </div>
                )}
              </section>

              <section className="card tracker-card" style={{ width: "100%" }}>
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">02 / TRACKING ENGINE</p>
                    <h2>Select algorithms</h2>
                  </div>
                  <span className="step">02</span>
                </div>
                <div className="tracker-list">
                  {trackers.map((tracker) => (
                    <button
                      className={`tracker-row ${tracker.selected ? "selected" : ""}`}
                      key={tracker.name}
                      onClick={() =>
                        setTrackers(
                          trackers.map((item) =>
                            item.name === tracker.name
                              ? { ...item, selected: !item.selected }
                              : item,
                          ),
                        )
                      }
                    >
                      <span className={`tracker-icon ${tracker.tone}`}>
                        {tracker.name.slice(0, 1)}
                      </span>
                      <span className="tracker-copy">
                        <b>{tracker.name}</b>
                        <small>{tracker.short}</small>
                      </span>
                      <span className="check">
                        {tracker.selected ? "✓" : ""}
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="card canvas-card" style={{ width: "100%" }}>
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">03 / INITIALIZATION</p>
                    <h2>Target preview</h2>
                  </div>
                  <span className="step">03</span>
                </div>
                <div className="canvas">
                  <div className="fake-video">
                    <div className="grid-lines" />
                    {results.length === 0 && (
                      <div
                        className="target"
                        style={{
                          left: bbox.x / 3,
                          top: bbox.y / 3,
                          width: bbox.width / 2.1,
                          height: bbox.height / 2.1,
                        }}
                      >
                        <span>Target</span>
                      </div>
                    )}
                    {results.length > 0 &&
                      results.map((result) => {
                        const frameData =
                          result.trajectory[currentFrame] ||
                          result.trajectory[result.trajectory.length - 1];
                        if (!frameData) return null;
                        const tone =
                          trackers.find((t) => t.name === result.tracker)
                            ?.tone || "blue";
                        return (
                          <div
                            key={result.tracker}
                            className={`target ${tone}`}
                            style={{
                              position: "absolute",
                              border: "2px solid currentColor",
                              color: `var(--${tone})`,
                              left: frameData[0] / 3,
                              top: frameData[1] / 3,
                              width: frameData[2] / 2.1,
                              height: frameData[3] / 2.1,
                              zIndex: 10,
                            }}
                          >
                            <span
                              style={{
                                backgroundColor: `var(--${tone})`,
                                color: "#fff",
                                fontSize: "10px",
                                padding: "2px 4px",
                              }}
                            >
                              {result.tracker}
                            </span>
                          </div>
                        );
                      })}
                    <span className="frame-label">
                      FRAME {String(currentFrame + 1).padStart(3, "0")} /{" "}
                      {session?.frames ?? "—"}
                    </span>
                  </div>
                </div>

                {results.length > 0 ? (
                  <div
                    className="playback-controls"
                    style={{
                      display: "flex",
                      gap: "1rem",
                      marginTop: "1rem",
                      alignItems: "center",
                    }}
                  >
                    <button
                      className="ghost-button"
                      onClick={() => setIsPlaying(!isPlaying)}
                    >
                      {isPlaying ? "⏸ Pause" : "▶ Play"}
                    </button>
                    <input
                      type="range"
                      min="0"
                      max={(session?.frames || 1) - 1}
                      value={currentFrame}
                      onChange={(e) => {
                        setCurrentFrame(Number(e.target.value));
                        setIsPlaying(false);
                      }}
                      style={{ flexGrow: 1, cursor: "ew-resize" }}
                    />
                  </div>
                ) : (
                  <div className="bbox-fields">
                    {(["x", "y", "width", "height"] as const).map((key) => (
                      <label key={key}>
                        {key}
                        <input
                          type="number"
                          min="0"
                          value={bbox[key]}
                          onChange={(event) =>
                            setBbox({
                              ...bbox,
                              [key]: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                )}
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={runComparison}
                >
                  {busy ? "Processing…" : "Run comparison"} <span>→</span>
                </button>
              </section>

              <section
                className="card results-card"
                id="benchmarks"
                style={{ width: "100%" }}
              >
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">04 / LIVE RESULTS</p>
                    <h2>Performance snapshot</h2>
                  </div>
                  <span className="live-pill">
                    <i /> READY
                  </span>
                </div>
                {results.length ? (
                  <div className="result-list">
                    {results.map((result) => (
                      <div
                        className="result-line"
                        key={result.tracker}
                        style={{ padding: "1rem 0" }}
                      >
                        <div className="result-main">
                          <b>{result.tracker}</b>
                          <small>{result.note ?? "Run completed"}</small>
                        </div>
                        <span className={result.status}>{result.status}</span>

                        {/* ACADEMIC METRICS DISPLAY */}
                        <div
                          className="result-stats"
                          style={{
                            display: "flex",
                            gap: "1rem",
                            textAlign: "right",
                          }}
                        >
                          <div>
                            <div style={{ fontSize: "11px", color: "#888" }}>
                              SPEED
                            </div>
                            <strong>
                              {result.fps ? `${result.fps} FPS` : "—"}
                            </strong>
                          </div>
                          {session?.has_ground_truth && (
                            <>
                              <div>
                                <div
                                  style={{ fontSize: "11px", color: "#888" }}
                                >
                                  PRECISION
                                </div>
                                <strong style={{ color: "var(--green)" }}>
                                  {result.precision
                                    ? `${result.precision}%`
                                    : "0%"}
                                </strong>
                              </div>
                              <div>
                                <div
                                  style={{ fontSize: "11px", color: "#888" }}
                                >
                                  SUCCESS AUC
                                </div>
                                <strong style={{ color: "var(--purple)" }}>
                                  {result.success_auc
                                    ? `${result.success_auc}%`
                                    : "0%"}
                                </strong>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="results-placeholder">
                    <div className="pulse">◎</div>
                    <b>
                      {session
                        ? "Run a comparison to populate results"
                        : "Your results will appear here"}
                    </b>
                    <span>Metrics require a Ground Truth upload.</span>
                  </div>
                )}
                <div className="metric-row">
                  <div>
                    <small>AVG. FPS</small>
                    <strong>
                      {benchmarks
                        ? `${benchmarks.average_fps.toFixed(1)}`
                        : "—"}
                    </strong>
                  </div>
                  <div>
                    <small>FRAMES ANALYZED</small>
                    <strong>
                      {benchmarks ? benchmarks.frames_analyzed : "—"}
                    </strong>
                  </div>
                </div>
              </section>
            </div>
          </>
        )}

        {/* The Session and Benchmark History Views remain identical to the previous code block */}
        {activeView === "sessions" && (
          <div
            className="card results-card"
            style={{ marginTop: "1rem", minHeight: "600px", width: "100%" }}
          >
            {history.length > 0 ? (
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    textAlign: "left",
                    borderCollapse: "collapse",
                    marginTop: "1rem",
                    fontSize: "15px",
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        borderBottom: "2px solid #eaeaea",
                        color: "#666",
                        fontSize: "13px",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                      }}
                    >
                      <th style={{ padding: "15px 10px 15px 0" }}>
                        Video File
                      </th>
                      <th style={{ padding: "15px 10px" }}>Video Specs</th>
                      <th style={{ padding: "15px 10px" }}>
                        Trackers Evaluated
                      </th>
                      <th style={{ padding: "15px 10px" }}>GT Link</th>
                      <th style={{ padding: "15px 10px", textAlign: "right" }}>
                        Date
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((s) => (
                      <tr
                        key={s.id}
                        style={{ borderBottom: "1px solid #f0f0f0" }}
                      >
                        <td
                          style={{
                            padding: "20px 10px 20px 0",
                            fontWeight: "600",
                            color: "#111",
                          }}
                        >
                          {s.filename}
                        </td>
                        <td style={{ padding: "20px 10px", color: "#555" }}>
                          <div>
                            {s.width}×{s.height}
                          </div>
                          <div style={{ fontSize: "13px", color: "#888" }}>
                            {s.frames} frames @ {s.fps.toFixed(1)}fps
                          </div>
                        </td>
                        <td style={{ padding: "20px 10px" }}>
                          {s.trackers?.length ? (
                            <span
                              style={{
                                display: "inline-flex",
                                gap: "5px",
                                flexWrap: "wrap",
                              }}
                            >
                              {s.trackers.map((t) => (
                                <span
                                  key={t}
                                  style={{
                                    backgroundColor: "#f4f4f5",
                                    padding: "3px 8px",
                                    borderRadius: "4px",
                                    fontSize: "13px",
                                    fontWeight: "500",
                                  }}
                                >
                                  {t}
                                </span>
                              ))}
                            </span>
                          ) : (
                            <span
                              style={{ color: "#999", fontStyle: "italic" }}
                            >
                              Uploaded only
                            </span>
                          )}
                        </td>
                        <td
                          style={{
                            padding: "20px 10px",
                            color: s.has_ground_truth ? "var(--green)" : "#999",
                            fontWeight: s.has_ground_truth ? "bold" : "normal",
                          }}
                        >
                          {s.has_ground_truth ? "Yes" : "No"}
                        </td>
                        <td
                          style={{
                            padding: "20px 10px",
                            textAlign: "right",
                            color: "#888",
                            fontSize: "14px",
                          }}
                        >
                          {new Date(s.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="results-placeholder">
                <b>No history found</b>
                <span>
                  Run a comparison in the workspace to save a session.
                </span>
              </div>
            )}
          </div>
        )}

        {activeView === "benchmarks" && (
          <div
            className="card results-card"
            style={{ marginTop: "1rem", width: "100%" }}
          >
            <p
              style={{
                color: "#666",
                marginBottom: "2rem",
                fontSize: "16px",
                lineHeight: "1.5",
              }}
            >
              Aggregate metrics calculated from all historical runs in your
              MongoDB database.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                gap: "1.5rem",
              }}
            >
              {["CSRT", "KCF", "MOSSE", "GOTURN"].map((trackerName) => {
                const stats = history
                  .flatMap((s) => s.results || [])
                  .filter((r) => r.tracker === trackerName && r.fps);
                const totalRuns = stats.length;
                const avgFps = totalRuns
                  ? (
                      stats.reduce((acc, r) => acc + (r.fps || 0), 0) /
                      totalRuns
                    ).toFixed(1)
                  : "0.0";
                const totalFrames = stats.reduce(
                  (acc, r) => acc + (r.num_frames_processed || 0),
                  0,
                );
                const totalFailures = stats.reduce(
                  (acc, r) => acc + (r.failures || 0),
                  0,
                );
                const reliability =
                  totalFrames > 0
                    ? (
                        ((totalFrames - totalFailures) / totalFrames) *
                        100
                      ).toFixed(1)
                    : "0.0";
                const tone =
                  initialTrackers.find((t) => t.name === trackerName)?.tone ||
                  "blue";

                return (
                  <div
                    key={trackerName}
                    style={{
                      border: "1px solid #eaeaea",
                      borderRadius: "12px",
                      padding: "1.5rem",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      backgroundColor: "#fff",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.02)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "1.5rem",
                      }}
                    >
                      <h3
                        style={{
                          margin: 0,
                          fontSize: "18px",
                          color: "#111",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <span
                          style={{
                            display: "inline-block",
                            width: "12px",
                            height: "12px",
                            borderRadius: "50%",
                            backgroundColor: `var(--${tone})`,
                          }}
                        />
                        {trackerName}
                      </h3>
                      <span
                        style={{
                          fontSize: "13px",
                          backgroundColor: "#f4f4f5",
                          padding: "4px 10px",
                          borderRadius: "12px",
                          color: "#555",
                          fontWeight: "500",
                        }}
                      >
                        {totalRuns} Runs
                      </span>
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "1rem",
                        marginBottom: "1rem",
                      }}
                    >
                      <div
                        style={{
                          backgroundColor: "#fafafa",
                          padding: "1rem",
                          borderRadius: "8px",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "12px",
                            color: "#888",
                            marginBottom: "4px",
                            textTransform: "uppercase",
                          }}
                        >
                          Avg Speed
                        </div>
                        <div
                          style={{
                            fontSize: "24px",
                            fontWeight: "700",
                            color: "#111",
                          }}
                        >
                          {avgFps}{" "}
                          <span
                            style={{
                              fontSize: "14px",
                              fontWeight: "500",
                              color: "#666",
                            }}
                          >
                            FPS
                          </span>
                        </div>
                      </div>
                      <div
                        style={{
                          backgroundColor: "#fafafa",
                          padding: "1rem",
                          borderRadius: "8px",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "12px",
                            color: "#888",
                            marginBottom: "4px",
                            textTransform: "uppercase",
                          }}
                        >
                          Reliability
                        </div>
                        <div
                          style={{
                            fontSize: "24px",
                            fontWeight: "700",
                            color: "#111",
                          }}
                        >
                          {reliability}
                          <span style={{ fontSize: "18px", fontWeight: "600" }}>
                            %
                          </span>
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        borderTop: "1px solid #eaeaea",
                        paddingTop: "1rem",
                        marginTop: "auto",
                        fontSize: "13px",
                        color: "#666",
                      }}
                    >
                      <span>
                        <b>{totalFrames.toLocaleString()}</b> total frames
                      </span>
                      <span>
                        <b>{totalFailures.toLocaleString()}</b> failures
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
// with auth
// "use client";

// import { ChangeEvent, useEffect, useMemo, useState } from "react";

// type Tracker = {
//   name: string;
//   short: string;
//   detail: string;
//   tone: string;
//   selected: boolean;
// };
// type Session = {
//   id: string;
//   filename: string;
//   frames: number;
//   fps: number;
//   width: number;
//   height: number;
// };
// type Result = {
//   tracker: string;
//   fps: number | null;
//   status: string;
//   trajectory: number[][];
//   note?: string;
//   num_frames_processed?: number;
//   failures?: number;
// };
// type HistorySession = Session & {
//   created_at: string;
//   trackers?: string[];
//   results?: Result[];
//   summary?: { average_fps: number; frames_analyzed: number };
// };

// const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
// const initialTrackers: Tracker[] = [
//   {
//     name: "CSRT",
//     short: "Channel & spatial reliability",
//     detail: "Robust to deformation and scale change",
//     tone: "purple",
//     selected: true,
//   },
//   {
//     name: "KCF",
//     short: "Kernelized correlation filter",
//     detail: "Fast, reliable baseline",
//     tone: "blue",
//     selected: true,
//   },
//   {
//     name: "MOSSE",
//     short: "Minimum output sum filter",
//     detail: "Ultra-fast, lightweight baseline",
//     tone: "orange",
//     selected: true,
//   },
//   {
//     name: "GOTURN",
//     short: "Deep regression network",
//     detail: "Learns complex motion patterns",
//     tone: "green",
//     selected: false,
//   },
// ];

// export default function Home() {
//   // --- Auth State ---
//   const [token, setToken] = useState<string | null>(null);
//   const [authMode, setAuthMode] = useState<"login" | "register">("login");
//   const [email, setEmail] = useState("");
//   const [password, setPassword] = useState("");
//   const [authError, setAuthError] = useState("");

//   // --- App State ---
//   const [activeView, setActiveView] = useState<
//     "workspace" | "sessions" | "benchmarks"
//   >("workspace");
//   const [history, setHistory] = useState<HistorySession[]>([]);

//   const [trackers, setTrackers] = useState(initialTrackers);
//   const [session, setSession] = useState<Session | null>(null);
//   const [bbox, setBbox] = useState({ x: 120, y: 95, width: 180, height: 150 });
//   const [file, setFile] = useState<File | null>(null);
//   const [busy, setBusy] = useState(false);
//   const [message, setMessage] = useState(
//     "Upload a video to begin a tracking session.",
//   );
//   const [results, setResults] = useState<Result[]>([]);
//   const [benchmarks, setBenchmarks] = useState<{
//     average_fps: number;
//     frames_analyzed: number;
//   } | null>(null);

//   const [currentFrame, setCurrentFrame] = useState(0);
//   const [isPlaying, setIsPlaying] = useState(false);

//   const selectedCount = useMemo(
//     () => trackers.filter((tracker) => tracker.selected).length,
//     [trackers],
//   );

//   useEffect(() => {
//     const savedToken = localStorage.getItem("vts_token");
//     if (savedToken) setToken(savedToken);
//   }, []);

//   useEffect(() => {
//     if (!isPlaying || !session) return;
//     const interval = setInterval(
//       () => {
//         setCurrentFrame((prev) => {
//           if (prev >= session.frames - 1) {
//             setIsPlaying(false);
//             return prev;
//           }
//           return prev + 1;
//         });
//       },
//       1000 / (session.fps || 30),
//     );
//     return () => clearInterval(interval);
//   }, [isPlaying, session]);

//   function logout() {
//     localStorage.removeItem("vts_token");
//     setToken(null);
//     setHistory([]);
//     setSession(null);
//     setResults([]);
//   }

//   async function handleAuth(e: React.FormEvent) {
//     e.preventDefault();
//     setAuthError("");
//     setBusy(true);
//     try {
//       if (authMode === "register") {
//         const res = await fetch(`${API_URL}/api/auth/register`, {
//           method: "POST",
//           headers: { "Content-Type": "application/json" },
//           body: JSON.stringify({ email, password }),
//         });
//         if (!res.ok) {
//           const errData = await res.json();
//           throw new Error(errData.detail || "Registration failed");
//         }
//         setAuthMode("login");
//         setAuthError("Registration successful. Please log in.");
//       } else {
//         const formData = new URLSearchParams();
//         formData.append("username", email);
//         formData.append("password", password);
//         const res = await fetch(`${API_URL}/api/auth/login`, {
//           method: "POST",
//           headers: { "Content-Type": "application/x-www-form-urlencoded" },
//           body: formData,
//         });
//         if (!res.ok) throw new Error("Invalid credentials");
//         const data = await res.json();
//         localStorage.setItem("vts_token", data.access_token);
//         setToken(data.access_token);
//       }
//     } catch (err: any) {
//       setAuthError(err.message);
//     } finally {
//       setBusy(false);
//     }
//   }

//   async function fetchHistory() {
//     try {
//       const res = await fetch(`${API_URL}/api/sessions`, {
//         headers: { Authorization: `Bearer ${token}` },
//       });
//       if (res.ok) setHistory(await res.json());
//     } catch (err) {
//       console.error("Failed to load history", err);
//     }
//   }

//   function handleNavigation(view: "workspace" | "sessions" | "benchmarks") {
//     setActiveView(view);
//     if (view !== "workspace") fetchHistory();
//   }

//   async function uploadVideo(event: ChangeEvent<HTMLInputElement>) {
//     const selectedFile = event.target.files?.[0];
//     if (!selectedFile) return;
//     setFile(selectedFile);
//     setBusy(true);
//     setMessage("Reading video metadata and creating a session...");
//     const form = new FormData();
//     form.append("file", selectedFile);
//     try {
//       const response = await fetch(`${API_URL}/api/sessions`, {
//         method: "POST",
//         body: form,
//         headers: { Authorization: `Bearer ${token}` },
//       });
//       if (!response.ok) throw new Error(await response.text());
//       setSession(await response.json());
//       setResults([]);
//       setCurrentFrame(0);
//       setMessage(
//         "Video ready. Adjust the target box, then run the comparison.",
//       );
//     } catch (error) {
//       setMessage(
//         error instanceof Error
//           ? error.message
//           : "Unable to connect to the tracking backend.",
//       );
//     } finally {
//       setBusy(false);
//     }
//   }

//   async function runComparison() {
//     if (!session)
//       return setMessage("Upload a video before starting a comparison.");
//     if (!selectedCount) return setMessage("Select at least one tracker.");

//     if (bbox.x < 0 || bbox.y < 0)
//       return setMessage("X and Y coordinates cannot be negative.");
//     if (bbox.width < 10 || bbox.height < 10)
//       return setMessage(
//         "Target box is too small. Width and height must be at least 10px.",
//       );
//     if (bbox.x >= session.width || bbox.y >= session.height)
//       return setMessage(
//         `Out of bounds. X must be < ${session.width} and Y must be < ${session.height}.`,
//       );
//     if (
//       bbox.x + bbox.width > session.width ||
//       bbox.y + bbox.height > session.height
//     )
//       return setMessage(
//         `Box goes off-screen! Ensure X+Width is ≤ ${session.width}, and Y+Height is ≤ ${session.height}.`,
//       );

//     setBusy(true);
//     setIsPlaying(false);
//     setCurrentFrame(0);
//     setMessage("Running trackers and saving metrics...");
//     try {
//       const response = await fetch(
//         `${API_URL}/api/sessions/${session.id}/track`,
//         {
//           method: "POST",
//           headers: {
//             "Content-Type": "application/json",
//             Authorization: `Bearer ${token}`,
//           },
//           body: JSON.stringify({
//             bbox,
//             trackers: trackers
//               .filter((tracker) => tracker.selected)
//               .map((tracker) => tracker.name),
//           }),
//         },
//       );
//       if (!response.ok) throw new Error(await response.text());
//       const payload = await response.json();
//       setResults(payload.results);
//       setBenchmarks(payload.benchmarks ?? null);
//       setMessage(
//         "Comparison complete. Press play to view tracker trajectories.",
//       );
//     } catch (error) {
//       setMessage(
//         error instanceof Error
//           ? error.message
//           : "The comparison could not be completed.",
//       );
//     } finally {
//       setBusy(false);
//     }
//   }

//   if (!token) {
//     return (
//       <div
//         style={{
//           display: "flex",
//           justifyContent: "center",
//           alignItems: "center",
//           minHeight: "100vh",
//           backgroundColor: "#f9f9f9",
//         }}
//       >
//         <form
//           onSubmit={handleAuth}
//           style={{
//             width: "100%",
//             maxWidth: "400px",
//             backgroundColor: "#fff",
//             padding: "2rem",
//             borderRadius: "12px",
//             boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
//           }}
//         >
//           <div
//             className="brand"
//             style={{
//               justifyContent: "center",
//               marginBottom: "2rem",
//               color: "#111",
//             }}
//           >
//             <span className="brand-mark">V</span>
//             <span>
//               VisualTracker <b>Studio</b>
//             </span>
//           </div>
//           <h2
//             style={{
//               marginBottom: "1.5rem",
//               textAlign: "center",
//               fontSize: "20px",
//             }}
//           >
//             {authMode === "login"
//               ? "Sign in to your workspace"
//               : "Create a new account"}
//           </h2>
//           {authError && (
//             <div
//               style={{
//                 backgroundColor: "#fff1f2",
//                 color: "#e11d48",
//                 padding: "10px",
//                 borderRadius: "6px",
//                 marginBottom: "1rem",
//                 fontSize: "14px",
//                 textAlign: "center",
//               }}
//             >
//               {authError}
//             </div>
//           )}
//           <label
//             style={{
//               display: "block",
//               marginBottom: "1rem",
//               fontSize: "14px",
//               fontWeight: "500",
//             }}
//           >
//             Email Address
//             <input
//               type="email"
//               required
//               value={email}
//               onChange={(e) => setEmail(e.target.value)}
//               style={{
//                 width: "100%",
//                 padding: "10px",
//                 marginTop: "5px",
//                 border: "1px solid #ddd",
//                 borderRadius: "6px",
//               }}
//             />
//           </label>
//           <label
//             style={{
//               display: "block",
//               marginBottom: "1.5rem",
//               fontSize: "14px",
//               fontWeight: "500",
//             }}
//           >
//             Password
//             <input
//               type="password"
//               required
//               value={password}
//               onChange={(e) => setPassword(e.target.value)}
//               style={{
//                 width: "100%",
//                 padding: "10px",
//                 marginTop: "5px",
//                 border: "1px solid #ddd",
//                 borderRadius: "6px",
//               }}
//             />
//           </label>
//           <button
//             type="submit"
//             className="primary-button"
//             disabled={busy}
//             style={{ width: "100%", justifyContent: "center" }}
//           >
//             {busy
//               ? "Processing..."
//               : authMode === "login"
//                 ? "Sign In"
//                 : "Register"}
//           </button>
//           <p
//             style={{
//               textAlign: "center",
//               marginTop: "1rem",
//               fontSize: "14px",
//               color: "#666",
//             }}
//           >
//             {authMode === "login"
//               ? "Don't have an account? "
//               : "Already have an account? "}
//             <a
//               href="#"
//               onClick={(e) => {
//                 e.preventDefault();
//                 setAuthMode(authMode === "login" ? "register" : "login");
//                 setAuthError("");
//               }}
//               style={{
//                 color: "var(--purple)",
//                 fontWeight: "600",
//                 textDecoration: "none",
//               }}
//             >
//               {authMode === "login" ? "Register here" : "Sign in here"}
//             </a>
//           </p>
//         </form>
//       </div>
//     );
//   }

//   return (
//     <main className="shell">
//       <aside className="sidebar">
//         <div className="brand">
//           <span className="brand-mark">V</span>
//           <span>
//             VisualTracker <b>Studio</b>
//           </span>
//         </div>
//         <nav>
//           <a
//             className={activeView === "workspace" ? "active" : ""}
//             onClick={() => handleNavigation("workspace")}
//             style={{ cursor: "pointer" }}
//           >
//             <span>◈</span> Workspace
//           </a>
//           <a
//             className={activeView === "sessions" ? "active" : ""}
//             onClick={() => handleNavigation("sessions")}
//             style={{ cursor: "pointer" }}
//           >
//             <span>◷</span> Sessions
//           </a>
//           <a
//             className={activeView === "benchmarks" ? "active" : ""}
//             onClick={() => handleNavigation("benchmarks")}
//             style={{ cursor: "pointer" }}
//           >
//             <span>▦</span> Benchmarks
//           </a>
//         </nav>
//         <div className="sidebar-bottom">
//           <div className="status-dot" /> Authenticated
//           <br />
//           <small>MongoDB persistence enabled</small>
//           <button
//             onClick={logout}
//             className="ghost-button"
//             style={{
//               marginTop: "10px",
//               width: "100%",
//               justifyContent: "center",
//               padding: "6px",
//             }}
//           >
//             Sign Out
//           </button>
//         </div>
//       </aside>

//       <section
//         className="content"
//         style={{ width: "100%", maxWidth: "1400px" }}
//       >
//         <header className="topbar">
//           <div>
//             <p className="eyebrow">RESEARCH WORKSPACE / SINGLE OBJECT</p>
//             <h1>
//               {activeView === "workspace"
//                 ? "Compare trackers"
//                 : activeView === "sessions"
//                   ? "Session History"
//                   : "Global Benchmarks"}
//             </h1>
//           </div>
//           <button className="ghost-button">Documentation ↗</button>
//         </header>

//         {activeView === "workspace" && (
//           <>
//             <div className="notice">
//               <span>✦</span>
//               <span>{message}</span>
//             </div>
//             <div className="workspace-grid" id="workspace">
//               <section className="card upload-card" style={{ width: "100%" }}>
//                 <div className="section-heading">
//                   <div>
//                     <p className="eyebrow">01 / SOURCE VIDEO</p>
//                     <h2>Upload a sequence</h2>
//                   </div>
//                   <span className="step">01</span>
//                 </div>
//                 <label className="dropzone">
//                   <input type="file" accept="video/*" onChange={uploadVideo} />
//                   <span className="upload-icon">↑</span>
//                   <strong>{file ? file.name : "Drop a video here"}</strong>
//                   <span>or click to browse · MP4, MOV, AVI</span>
//                 </label>
//                 {session && (
//                   <div className="video-meta">
//                     <span>
//                       <b>
//                         {session.width}×{session.height}
//                       </b>{" "}
//                       resolution
//                     </span>
//                     <span>
//                       <b>{session.frames}</b> frames
//                     </span>
//                     <span>
//                       <b>{session.fps.toFixed(1)}</b> FPS
//                     </span>
//                   </div>
//                 )}
//               </section>

//               <section className="card tracker-card" style={{ width: "100%" }}>
//                 <div className="section-heading">
//                   <div>
//                     <p className="eyebrow">02 / TRACKING ENGINE</p>
//                     <h2>Select algorithms</h2>
//                   </div>
//                   <span className="step">02</span>
//                 </div>
//                 <div className="tracker-list">
//                   {trackers.map((tracker) => (
//                     <button
//                       className={`tracker-row ${tracker.selected ? "selected" : ""}`}
//                       key={tracker.name}
//                       onClick={() =>
//                         setTrackers(
//                           trackers.map((item) =>
//                             item.name === tracker.name
//                               ? { ...item, selected: !item.selected }
//                               : item,
//                           ),
//                         )
//                       }
//                     >
//                       <span className={`tracker-icon ${tracker.tone}`}>
//                         {tracker.name.slice(0, 1)}
//                       </span>
//                       <span className="tracker-copy">
//                         <b>{tracker.name}</b>
//                         <small>{tracker.short}</small>
//                       </span>
//                       <span className="check">
//                         {tracker.selected ? "✓" : ""}
//                       </span>
//                     </button>
//                   ))}
//                 </div>
//               </section>

//               <section className="card canvas-card" style={{ width: "100%" }}>
//                 <div className="section-heading">
//                   <div>
//                     <p className="eyebrow">03 / INITIALIZATION</p>
//                     <h2>Draw target bounding box</h2>
//                   </div>
//                   <span className="step">03</span>
//                 </div>
//                 <div className="canvas">
//                   <div className="fake-video">
//                     <div className="grid-lines" />
//                     {results.length === 0 && (
//                       <div
//                         className="target"
//                         style={{
//                           left: bbox.x / 3,
//                           top: bbox.y / 3,
//                           width: bbox.width / 2.1,
//                           height: bbox.height / 2.1,
//                         }}
//                       >
//                         <span>Target</span>
//                       </div>
//                     )}
//                     {results.length > 0 &&
//                       results.map((result) => {
//                         const frameData =
//                           result.trajectory[currentFrame] ||
//                           result.trajectory[result.trajectory.length - 1];
//                         if (!frameData) return null;
//                         const tone =
//                           trackers.find((t) => t.name === result.tracker)
//                             ?.tone || "blue";
//                         return (
//                           <div
//                             key={result.tracker}
//                             className={`target ${tone}`}
//                             style={{
//                               position: "absolute",
//                               border: "2px solid currentColor",
//                               color: `var(--${tone})`,
//                               left: frameData[0] / 3,
//                               top: frameData[1] / 3,
//                               width: frameData[2] / 2.1,
//                               height: frameData[3] / 2.1,
//                               zIndex: 10,
//                             }}
//                           >
//                             <span
//                               style={{
//                                 backgroundColor: `var(--${tone})`,
//                                 color: "#fff",
//                                 fontSize: "10px",
//                                 padding: "2px 4px",
//                               }}
//                             >
//                               {result.tracker}
//                             </span>
//                           </div>
//                         );
//                       })}
//                     <span className="frame-label">
//                       FRAME {String(currentFrame + 1).padStart(3, "0")} /{" "}
//                       {session?.frames ?? "—"}
//                     </span>
//                   </div>
//                 </div>

//                 {results.length > 0 ? (
//                   <div
//                     className="playback-controls"
//                     style={{
//                       display: "flex",
//                       gap: "1rem",
//                       marginTop: "1rem",
//                       alignItems: "center",
//                     }}
//                   >
//                     <button
//                       className="ghost-button"
//                       onClick={() => setIsPlaying(!isPlaying)}
//                     >
//                       {isPlaying ? "⏸ Pause" : "▶ Play"}
//                     </button>
//                     <input
//                       type="range"
//                       min="0"
//                       max={(session?.frames || 1) - 1}
//                       value={currentFrame}
//                       onChange={(e) => {
//                         setCurrentFrame(Number(e.target.value));
//                         setIsPlaying(false);
//                       }}
//                       style={{ flexGrow: 1, cursor: "ew-resize" }}
//                     />
//                   </div>
//                 ) : (
//                   <div className="bbox-fields">
//                     {(["x", "y", "width", "height"] as const).map((key) => (
//                       <label key={key}>
//                         {key}
//                         <input
//                           type="number"
//                           min="0"
//                           value={bbox[key]}
//                           onChange={(event) =>
//                             setBbox({
//                               ...bbox,
//                               [key]: Number(event.target.value),
//                             })
//                           }
//                         />
//                       </label>
//                     ))}
//                   </div>
//                 )}
//                 <button
//                   className="primary-button"
//                   disabled={busy}
//                   onClick={runComparison}
//                 >
//                   {busy ? "Processing…" : "Run comparison"} <span>→</span>
//                 </button>
//               </section>

//               <section
//                 className="card results-card"
//                 id="benchmarks"
//                 style={{ width: "100%" }}
//               >
//                 <div className="section-heading">
//                   <div>
//                     <p className="eyebrow">04 / LIVE RESULTS</p>
//                     <h2>Performance snapshot</h2>
//                   </div>
//                   <span className="live-pill">
//                     <i /> READY
//                   </span>
//                 </div>
//                 {results.length ? (
//                   <div className="result-list">
//                     {results.map((result) => (
//                       <div className="result-line" key={result.tracker}>
//                         <div className="result-main">
//                           <b>{result.tracker}</b>
//                           <small>{result.note ?? "Run completed"}</small>
//                         </div>
//                         <span className={result.status}>{result.status}</span>
//                         <div className="result-stats">
//                           <strong>
//                             {result.fps ? `${result.fps} FPS` : "—"}
//                           </strong>
//                         </div>
//                       </div>
//                     ))}
//                   </div>
//                 ) : (
//                   <div className="results-placeholder">
//                     <div className="pulse">◎</div>
//                     <b>
//                       {session
//                         ? "Run a comparison to populate results"
//                         : "Your results will appear here"}
//                     </b>
//                     <span>
//                       FPS and failure cases will be logged per tracker.
//                     </span>
//                   </div>
//                 )}
//                 <div className="metric-row">
//                   <div>
//                     <small>AVG. FPS</small>
//                     <strong>
//                       {benchmarks
//                         ? `${benchmarks.average_fps.toFixed(1)}`
//                         : "—"}
//                     </strong>
//                   </div>
//                   <div>
//                     <small>FRAMES ANALYZED</small>
//                     <strong>
//                       {benchmarks ? benchmarks.frames_analyzed : "—"}
//                     </strong>
//                   </div>
//                 </div>
//               </section>
//             </div>
//           </>
//         )}

//         {/* --- EXPANDED SESSION HISTORY VIEW --- */}
//         {activeView === "sessions" && (
//           <div
//             className="card results-card"
//             style={{ marginTop: "1rem", minHeight: "600px", width: "100%" }}
//           >
//             {history.length > 0 ? (
//               <div style={{ overflowX: "auto" }}>
//                 <table
//                   style={{
//                     width: "100%",
//                     textAlign: "left",
//                     borderCollapse: "collapse",
//                     marginTop: "1rem",
//                     fontSize: "15px",
//                   }}
//                 >
//                   <thead>
//                     <tr
//                       style={{
//                         borderBottom: "2px solid #eaeaea",
//                         color: "#666",
//                         fontSize: "13px",
//                         textTransform: "uppercase",
//                         letterSpacing: "0.5px",
//                       }}
//                     >
//                       <th style={{ padding: "15px 10px 15px 0" }}>
//                         Video File
//                       </th>
//                       <th style={{ padding: "15px 10px" }}>Video Specs</th>
//                       <th style={{ padding: "15px 10px" }}>
//                         Trackers Evaluated
//                       </th>
//                       <th style={{ padding: "15px 10px" }}>Avg Session FPS</th>
//                       <th style={{ padding: "15px 10px", textAlign: "right" }}>
//                         Date
//                       </th>
//                     </tr>
//                   </thead>
//                   <tbody>
//                     {history.map((s) => (
//                       <tr
//                         key={s.id}
//                         style={{ borderBottom: "1px solid #f0f0f0" }}
//                       >
//                         <td
//                           style={{
//                             padding: "20px 10px 20px 0",
//                             fontWeight: "600",
//                             color: "#111",
//                           }}
//                         >
//                           {s.filename}
//                         </td>
//                         <td style={{ padding: "20px 10px", color: "#555" }}>
//                           <div>
//                             {s.width}×{s.height}
//                           </div>
//                           <div style={{ fontSize: "13px", color: "#888" }}>
//                             {s.frames} frames @ {s.fps.toFixed(1)}fps
//                           </div>
//                         </td>
//                         <td style={{ padding: "20px 10px" }}>
//                           {s.trackers?.length ? (
//                             <span
//                               style={{
//                                 display: "inline-flex",
//                                 gap: "5px",
//                                 flexWrap: "wrap",
//                               }}
//                             >
//                               {s.trackers.map((t) => (
//                                 <span
//                                   key={t}
//                                   style={{
//                                     backgroundColor: "#f4f4f5",
//                                     padding: "3px 8px",
//                                     borderRadius: "4px",
//                                     fontSize: "13px",
//                                     fontWeight: "500",
//                                   }}
//                                 >
//                                   {t}
//                                 </span>
//                               ))}
//                             </span>
//                           ) : (
//                             <span
//                               style={{ color: "#999", fontStyle: "italic" }}
//                             >
//                               Uploaded only
//                             </span>
//                           )}
//                         </td>
//                         <td
//                           style={{
//                             padding: "20px 10px",
//                             fontWeight: "bold",
//                             color: s.summary ? "#111" : "#999",
//                           }}
//                         >
//                           {s.summary
//                             ? `${s.summary.average_fps.toFixed(1)}`
//                             : "—"}
//                         </td>
//                         <td
//                           style={{
//                             padding: "20px 10px",
//                             textAlign: "right",
//                             color: "#888",
//                             fontSize: "14px",
//                           }}
//                         >
//                           {new Date(s.created_at).toLocaleDateString(
//                             undefined,
//                             { year: "numeric", month: "short", day: "numeric" },
//                           )}
//                         </td>
//                       </tr>
//                     ))}
//                   </tbody>
//                 </table>
//               </div>
//             ) : (
//               <div className="results-placeholder">
//                 <b>No history found</b>
//                 <span>
//                   Run a comparison in the workspace to save a session.
//                 </span>
//               </div>
//             )}
//           </div>
//         )}

//         {/* --- EXPANDED GLOBAL BENCHMARKS VIEW --- */}
//         {activeView === "benchmarks" && (
//           <div
//             className="card results-card"
//             style={{ marginTop: "1rem", width: "100%" }}
//           >
//             <p
//               style={{
//                 color: "#666",
//                 marginBottom: "2rem",
//                 fontSize: "16px",
//                 lineHeight: "1.5",
//               }}
//             >
//               Aggregate performance metrics calculated dynamically from all
//               completed SOT runs in your MongoDB database.
//             </p>

//             <div
//               style={{
//                 display: "grid",
//                 gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
//                 gap: "1.5rem",
//               }}
//             >
//               {["CSRT", "KCF", "MOSSE", "GOTURN"].map((trackerName) => {
//                 const stats = history
//                   .flatMap((s) => s.results || [])
//                   .filter((r) => r.tracker === trackerName && r.fps);

//                 // Calculate aggregated metrics
//                 const totalRuns = stats.length;
//                 const avgFps = totalRuns
//                   ? (
//                       stats.reduce((acc, r) => acc + (r.fps || 0), 0) /
//                       totalRuns
//                     ).toFixed(1)
//                   : "0.0";
//                 const totalFrames = stats.reduce(
//                   (acc, r) => acc + (r.num_frames_processed || 0),
//                   0,
//                 );
//                 const totalFailures = stats.reduce(
//                   (acc, r) => acc + (r.failures || 0),
//                   0,
//                 );

//                 const reliability =
//                   totalFrames > 0
//                     ? (
//                         ((totalFrames - totalFailures) / totalFrames) *
//                         100
//                       ).toFixed(1)
//                     : "0.0";

//                 const tone =
//                   initialTrackers.find((t) => t.name === trackerName)?.tone ||
//                   "blue";

//                 return (
//                   <div
//                     key={trackerName}
//                     style={{
//                       border: "1px solid #eaeaea",
//                       borderRadius: "12px",
//                       padding: "1.5rem",
//                       display: "flex",
//                       flexDirection: "column",
//                       justifyContent: "space-between",
//                       backgroundColor: "#fff",
//                       boxShadow: "0 2px 8px rgba(0,0,0,0.02)",
//                     }}
//                   >
//                     <div
//                       style={{
//                         display: "flex",
//                         justifyContent: "space-between",
//                         alignItems: "center",
//                         marginBottom: "1.5rem",
//                       }}
//                     >
//                       <h3
//                         style={{
//                           margin: 0,
//                           fontSize: "18px",
//                           color: "#111",
//                           display: "flex",
//                           alignItems: "center",
//                           gap: "8px",
//                         }}
//                       >
//                         <span
//                           style={{
//                             display: "inline-block",
//                             width: "12px",
//                             height: "12px",
//                             borderRadius: "50%",
//                             backgroundColor: `var(--${tone})`,
//                           }}
//                         />
//                         {trackerName}
//                       </h3>
//                       <span
//                         style={{
//                           fontSize: "13px",
//                           backgroundColor: "#f4f4f5",
//                           padding: "4px 10px",
//                           borderRadius: "12px",
//                           color: "#555",
//                           fontWeight: "500",
//                         }}
//                       >
//                         {totalRuns} Runs
//                       </span>
//                     </div>

//                     <div
//                       style={{
//                         display: "grid",
//                         gridTemplateColumns: "1fr 1fr",
//                         gap: "1rem",
//                         marginBottom: "1rem",
//                       }}
//                     >
//                       <div
//                         style={{
//                           backgroundColor: "#fafafa",
//                           padding: "1rem",
//                           borderRadius: "8px",
//                         }}
//                       >
//                         <div
//                           style={{
//                             fontSize: "12px",
//                             color: "#888",
//                             marginBottom: "4px",
//                             textTransform: "uppercase",
//                             letterSpacing: "0.5px",
//                           }}
//                         >
//                           Avg Speed
//                         </div>
//                         <div
//                           style={{
//                             fontSize: "24px",
//                             fontWeight: "700",
//                             color: "#111",
//                           }}
//                         >
//                           {avgFps}{" "}
//                           <span
//                             style={{
//                               fontSize: "14px",
//                               fontWeight: "500",
//                               color: "#666",
//                             }}
//                           >
//                             FPS
//                           </span>
//                         </div>
//                       </div>
//                       <div
//                         style={{
//                           backgroundColor: "#fafafa",
//                           padding: "1rem",
//                           borderRadius: "8px",
//                         }}
//                       >
//                         <div
//                           style={{
//                             fontSize: "12px",
//                             color: "#888",
//                             marginBottom: "4px",
//                             textTransform: "uppercase",
//                             letterSpacing: "0.5px",
//                           }}
//                         >
//                           Reliability
//                         </div>
//                         <div
//                           style={{
//                             fontSize: "24px",
//                             fontWeight: "700",
//                             color: "#111",
//                           }}
//                         >
//                           {reliability}
//                           <span style={{ fontSize: "18px", fontWeight: "600" }}>
//                             %
//                           </span>
//                         </div>
//                       </div>
//                     </div>

//                     <div
//                       style={{
//                         display: "flex",
//                         justifyContent: "space-between",
//                         borderTop: "1px solid #eaeaea",
//                         paddingTop: "1rem",
//                         marginTop: "auto",
//                         fontSize: "13px",
//                         color: "#666",
//                       }}
//                     >
//                       <span>
//                         <b>{totalFrames.toLocaleString()}</b> total frames
//                       </span>
//                       <span>
//                         <b>{totalFailures.toLocaleString()}</b> failures
//                       </span>
//                     </div>
//                   </div>
//                 );
//               })}
//             </div>
//           </div>
//         )}
//       </section>
//     </main>
//   );
// }

// without auth
// "use client";

// import { ChangeEvent, useEffect, useMemo, useState } from "react";

// type Tracker = {
//   name: string;
//   short: string;
//   detail: string;
//   tone: string;
//   selected: boolean;
// };
// type Session = {
//   id: string;
//   filename: string;
//   frames: number;
//   fps: number;
//   width: number;
//   height: number;
// };
// type Result = {
//   tracker: string;
//   fps: number | null;
//   status: string;
//   trajectory: number[][];
//   note?: string;
//   num_frames_processed?: number;
//   failures?: number;
// };
// type HistorySession = Session & {
//   created_at: string;
//   trackers?: string[];
//   results?: Result[];
//   summary?: { average_fps: number; frames_analyzed: number };
// };

// const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
// const initialTrackers: Tracker[] = [
//   {
//     name: "CSRT",
//     short: "Channel & spatial reliability",
//     detail: "Robust to deformation and scale change",
//     tone: "purple",
//     selected: true,
//   },
//   {
//     name: "KCF",
//     short: "Kernelized correlation filter",
//     detail: "Fast, reliable baseline",
//     tone: "blue",
//     selected: true,
//   },
//   {
//     name: "MOSSE",
//     short: "Minimum output sum filter",
//     detail: "Ultra-fast, lightweight baseline",
//     tone: "orange",
//     selected: true,
//   },
//   {
//     name: "GOTURN",
//     short: "Deep regression network",
//     detail: "Learns complex motion patterns",
//     tone: "green",
//     selected: false,
//   },
// ];

// export default function Home() {
//   const [activeView, setActiveView] = useState<
//     "workspace" | "sessions" | "benchmarks"
//   >("workspace");
//   const [history, setHistory] = useState<HistorySession[]>([]);

//   const [trackers, setTrackers] = useState(initialTrackers);
//   const [session, setSession] = useState<Session | null>(null);
//   const [bbox, setBbox] = useState({ x: 120, y: 95, width: 180, height: 150 });
//   const [file, setFile] = useState<File | null>(null);
//   const [busy, setBusy] = useState(false);
//   const [message, setMessage] = useState(
//     "Upload a video to begin a tracking session.",
//   );
//   const [results, setResults] = useState<Result[]>([]);
//   const [benchmarks, setBenchmarks] = useState<{
//     average_fps: number;
//     frames_analyzed: number;
//   } | null>(null);

//   const [currentFrame, setCurrentFrame] = useState(0);
//   const [isPlaying, setIsPlaying] = useState(false);

//   const selectedCount = useMemo(
//     () => trackers.filter((tracker) => tracker.selected).length,
//     [trackers],
//   );

//   useEffect(() => {
//     if (!isPlaying || !session) return;
//     const interval = setInterval(
//       () => {
//         setCurrentFrame((prev) => {
//           if (prev >= session.frames - 1) {
//             setIsPlaying(false);
//             return prev;
//           }
//           return prev + 1;
//         });
//       },
//       1000 / (session.fps || 30),
//     );
//     return () => clearInterval(interval);
//   }, [isPlaying, session]);

//   async function fetchHistory() {
//     try {
//       const res = await fetch(`${API_URL}/api/sessions`);
//       if (res.ok) setHistory(await res.json());
//     } catch (err) {
//       console.error("Failed to load history", err);
//     }
//   }

//   function handleNavigation(view: "workspace" | "sessions" | "benchmarks") {
//     setActiveView(view);
//     if (view !== "workspace") fetchHistory();
//   }

//   async function uploadVideo(event: ChangeEvent<HTMLInputElement>) {
//     const selectedFile = event.target.files?.[0];
//     if (!selectedFile) return;
//     setFile(selectedFile);
//     setBusy(true);
//     setMessage("Reading video metadata and creating a session...");
//     const form = new FormData();
//     form.append("file", selectedFile);
//     try {
//       const response = await fetch(`${API_URL}/api/sessions`, {
//         method: "POST",
//         body: form,
//       });
//       if (!response.ok) throw new Error(await response.text());
//       setSession(await response.json());
//       setResults([]);
//       setCurrentFrame(0);
//       setMessage(
//         "Video ready. Adjust the target box, then run the comparison.",
//       );
//     } catch (error) {
//       setMessage(
//         error instanceof Error
//           ? error.message
//           : "Unable to connect to the tracking backend.",
//       );
//     } finally {
//       setBusy(false);
//     }
//   }

//   async function runComparison() {
//     if (!session)
//       return setMessage("Upload a video before starting a comparison.");
//     if (!selectedCount) return setMessage("Select at least one tracker.");

//     if (bbox.x < 0 || bbox.y < 0)
//       return setMessage("X and Y coordinates cannot be negative.");
//     if (bbox.width < 10 || bbox.height < 10)
//       return setMessage(
//         "Target box is too small. Width and height must be at least 10px.",
//       );
//     if (bbox.x >= session.width || bbox.y >= session.height)
//       return setMessage(
//         `Out of bounds. X must be < ${session.width} and Y must be < ${session.height}.`,
//       );
//     if (
//       bbox.x + bbox.width > session.width ||
//       bbox.y + bbox.height > session.height
//     )
//       return setMessage(
//         `Box goes off-screen! Ensure X+Width is ≤ ${session.width}, and Y+Height is ≤ ${session.height}.`,
//       );

//     setBusy(true);
//     setIsPlaying(false);
//     setCurrentFrame(0);
//     setMessage("Running trackers and saving metrics...");
//     try {
//       const response = await fetch(
//         `${API_URL}/api/sessions/${session.id}/track`,
//         {
//           method: "POST",
//           headers: { "Content-Type": "application/json" },
//           body: JSON.stringify({
//             bbox,
//             trackers: trackers
//               .filter((tracker) => tracker.selected)
//               .map((tracker) => tracker.name),
//           }),
//         },
//       );
//       if (!response.ok) throw new Error(await response.text());
//       const payload = await response.json();
//       setResults(payload.results);
//       setBenchmarks(payload.benchmarks ?? null);
//       setMessage(
//         "Comparison complete. Press play to view tracker trajectories.",
//       );
//     } catch (error) {
//       setMessage(
//         error instanceof Error
//           ? error.message
//           : "The comparison could not be completed.",
//       );
//     } finally {
//       setBusy(false);
//     }
//   }

//   return (
//     <main className="shell">
//       <aside className="sidebar">
//         <div className="brand">
//           <span className="brand-mark">V</span>
//           <span>
//             VisualTracker <b>Studio</b>
//           </span>
//         </div>
//         <nav>
//           <a
//             className={activeView === "workspace" ? "active" : ""}
//             onClick={() => handleNavigation("workspace")}
//             style={{ cursor: "pointer" }}
//           >
//             <span>◈</span> Workspace
//           </a>
//           <a
//             className={activeView === "sessions" ? "active" : ""}
//             onClick={() => handleNavigation("sessions")}
//             style={{ cursor: "pointer" }}
//           >
//             <span>◷</span> Sessions
//           </a>
//           <a
//             className={activeView === "benchmarks" ? "active" : ""}
//             onClick={() => handleNavigation("benchmarks")}
//             style={{ cursor: "pointer" }}
//           >
//             <span>▦</span> Benchmarks
//           </a>
//         </nav>
//         <div className="sidebar-bottom">
//           <div className="status-dot" /> Backend connected
//           <br />
//           <small>MongoDB persistence enabled</small>
//         </div>
//       </aside>

//       <section
//         className="content"
//         style={{ width: "100%", maxWidth: "1400px" }}
//       >
//         <header className="topbar">
//           <div>
//             <p className="eyebrow">RESEARCH WORKSPACE / SINGLE OBJECT</p>
//             <h1>
//               {activeView === "workspace"
//                 ? "Compare trackers"
//                 : activeView === "sessions"
//                   ? "Session History"
//                   : "Global Benchmarks"}
//             </h1>
//           </div>
//           <button className="ghost-button">Documentation ↗</button>
//         </header>

//         {activeView === "workspace" && (
//           <>
//             <div className="notice">
//               <span>✦</span>
//               <span>{message}</span>
//             </div>
//             <div className="workspace-grid" id="workspace">
//               <section className="card upload-card" style={{ width: "100%" }}>
//                 <div className="section-heading">
//                   <div>
//                     <p className="eyebrow">01 / SOURCE VIDEO</p>
//                     <h2>Upload a sequence</h2>
//                   </div>
//                   <span className="step">01</span>
//                 </div>
//                 <label className="dropzone">
//                   <input type="file" accept="video/*" onChange={uploadVideo} />
//                   <span className="upload-icon">↑</span>
//                   <strong>{file ? file.name : "Drop a video here"}</strong>
//                   <span>or click to browse · MP4, MOV, AVI</span>
//                 </label>
//                 {session && (
//                   <div className="video-meta">
//                     <span>
//                       <b>
//                         {session.width}×{session.height}
//                       </b>{" "}
//                       resolution
//                     </span>
//                     <span>
//                       <b>{session.frames}</b> frames
//                     </span>
//                     <span>
//                       <b>{session.fps.toFixed(1)}</b> FPS
//                     </span>
//                   </div>
//                 )}
//               </section>

//               <section className="card tracker-card" style={{ width: "100%" }}>
//                 <div className="section-heading">
//                   <div>
//                     <p className="eyebrow">02 / TRACKING ENGINE</p>
//                     <h2>Select algorithms</h2>
//                   </div>
//                   <span className="step">02</span>
//                 </div>
//                 <div className="tracker-list">
//                   {trackers.map((tracker) => (
//                     <button
//                       className={`tracker-row ${tracker.selected ? "selected" : ""}`}
//                       key={tracker.name}
//                       onClick={() =>
//                         setTrackers(
//                           trackers.map((item) =>
//                             item.name === tracker.name
//                               ? { ...item, selected: !item.selected }
//                               : item,
//                           ),
//                         )
//                       }
//                     >
//                       <span className={`tracker-icon ${tracker.tone}`}>
//                         {tracker.name.slice(0, 1)}
//                       </span>
//                       <span className="tracker-copy">
//                         <b>{tracker.name}</b>
//                         <small>{tracker.short}</small>
//                       </span>
//                       <span className="check">
//                         {tracker.selected ? "✓" : ""}
//                       </span>
//                     </button>
//                   ))}
//                 </div>
//               </section>

//               <section className="card canvas-card" style={{ width: "100%" }}>
//                 <div className="section-heading">
//                   <div>
//                     <p className="eyebrow">03 / INITIALIZATION</p>
//                     <h2>Draw target bounding box</h2>
//                   </div>
//                   <span className="step">03</span>
//                 </div>
//                 <div className="canvas">
//                   <div className="fake-video">
//                     <div className="grid-lines" />
//                     {results.length === 0 && (
//                       <div
//                         className="target"
//                         style={{
//                           left: bbox.x / 3,
//                           top: bbox.y / 3,
//                           width: bbox.width / 2.1,
//                           height: bbox.height / 2.1,
//                         }}
//                       >
//                         <span>Target</span>
//                       </div>
//                     )}
//                     {results.length > 0 &&
//                       results.map((result) => {
//                         const frameData =
//                           result.trajectory[currentFrame] ||
//                           result.trajectory[result.trajectory.length - 1];
//                         if (!frameData) return null;
//                         const tone =
//                           trackers.find((t) => t.name === result.tracker)
//                             ?.tone || "blue";
//                         return (
//                           <div
//                             key={result.tracker}
//                             className={`target ${tone}`}
//                             style={{
//                               position: "absolute",
//                               border: "2px solid currentColor",
//                               color: `var(--${tone})`,
//                               left: frameData[0] / 3,
//                               top: frameData[1] / 3,
//                               width: frameData[2] / 2.1,
//                               height: frameData[3] / 2.1,
//                               zIndex: 10,
//                             }}
//                           >
//                             <span
//                               style={{
//                                 backgroundColor: `var(--${tone})`,
//                                 color: "#fff",
//                                 fontSize: "10px",
//                                 padding: "2px 4px",
//                               }}
//                             >
//                               {result.tracker}
//                             </span>
//                           </div>
//                         );
//                       })}
//                     <span className="frame-label">
//                       FRAME {String(currentFrame + 1).padStart(3, "0")} /{" "}
//                       {session?.frames ?? "—"}
//                     </span>
//                   </div>
//                 </div>

//                 {results.length > 0 ? (
//                   <div
//                     className="playback-controls"
//                     style={{
//                       display: "flex",
//                       gap: "1rem",
//                       marginTop: "1rem",
//                       alignItems: "center",
//                     }}
//                   >
//                     <button
//                       className="ghost-button"
//                       onClick={() => setIsPlaying(!isPlaying)}
//                     >
//                       {isPlaying ? "⏸ Pause" : "▶ Play"}
//                     </button>
//                     <input
//                       type="range"
//                       min="0"
//                       max={(session?.frames || 1) - 1}
//                       value={currentFrame}
//                       onChange={(e) => {
//                         setCurrentFrame(Number(e.target.value));
//                         setIsPlaying(false);
//                       }}
//                       style={{ flexGrow: 1, cursor: "ew-resize" }}
//                     />
//                   </div>
//                 ) : (
//                   <div className="bbox-fields">
//                     {(["x", "y", "width", "height"] as const).map((key) => (
//                       <label key={key}>
//                         {key}
//                         <input
//                           type="number"
//                           min="0"
//                           value={bbox[key]}
//                           onChange={(event) =>
//                             setBbox({
//                               ...bbox,
//                               [key]: Number(event.target.value),
//                             })
//                           }
//                         />
//                       </label>
//                     ))}
//                   </div>
//                 )}
//                 <button
//                   className="primary-button"
//                   disabled={busy}
//                   onClick={runComparison}
//                 >
//                   {busy ? "Processing…" : "Run comparison"} <span>→</span>
//                 </button>
//               </section>

//               <section
//                 className="card results-card"
//                 id="benchmarks"
//                 style={{ width: "100%" }}
//               >
//                 <div className="section-heading">
//                   <div>
//                     <p className="eyebrow">04 / LIVE RESULTS</p>
//                     <h2>Performance snapshot</h2>
//                   </div>
//                   <span className="live-pill">
//                     <i /> READY
//                   </span>
//                 </div>
//                 {results.length ? (
//                   <div className="result-list">
//                     {results.map((result) => (
//                       <div className="result-line" key={result.tracker}>
//                         <div className="result-main">
//                           <b>{result.tracker}</b>
//                           <small>{result.note ?? "Run completed"}</small>
//                         </div>
//                         <span className={result.status}>{result.status}</span>
//                         <div className="result-stats">
//                           <strong>
//                             {result.fps ? `${result.fps} FPS` : "—"}
//                           </strong>
//                         </div>
//                       </div>
//                     ))}
//                   </div>
//                 ) : (
//                   <div className="results-placeholder">
//                     <div className="pulse">◎</div>
//                     <b>
//                       {session
//                         ? "Run a comparison to populate results"
//                         : "Your results will appear here"}
//                     </b>
//                     <span>
//                       FPS and failure cases will be logged per tracker.
//                     </span>
//                   </div>
//                 )}
//                 <div className="metric-row">
//                   <div>
//                     <small>AVG. FPS</small>
//                     <strong>
//                       {benchmarks
//                         ? `${benchmarks.average_fps.toFixed(1)}`
//                         : "—"}
//                     </strong>
//                   </div>
//                   <div>
//                     <small>FRAMES ANALYZED</small>
//                     <strong>
//                       {benchmarks ? benchmarks.frames_analyzed : "—"}
//                     </strong>
//                   </div>
//                 </div>
//               </section>
//             </div>
//           </>
//         )}

//         {/* --- EXPANDED SESSION HISTORY VIEW --- */}
//         {activeView === "sessions" && (
//           <div
//             className="card results-card"
//             style={{ marginTop: "1rem", minHeight: "600px", width: "100%" }}
//           >
//             {history.length > 0 ? (
//               <div style={{ overflowX: "auto" }}>
//                 <table
//                   style={{
//                     width: "100%",
//                     textAlign: "left",
//                     borderCollapse: "collapse",
//                     marginTop: "1rem",
//                     fontSize: "15px",
//                   }}
//                 >
//                   <thead>
//                     <tr
//                       style={{
//                         borderBottom: "2px solid #eaeaea",
//                         color: "#666",
//                         fontSize: "13px",
//                         textTransform: "uppercase",
//                         letterSpacing: "0.5px",
//                       }}
//                     >
//                       <th style={{ padding: "15px 10px 15px 0" }}>
//                         Video File
//                       </th>
//                       <th style={{ padding: "15px 10px" }}>Video Specs</th>
//                       <th style={{ padding: "15px 10px" }}>
//                         Trackers Evaluated
//                       </th>
//                       <th style={{ padding: "15px 10px" }}>Avg Session FPS</th>
//                       <th style={{ padding: "15px 10px", textAlign: "right" }}>
//                         Date
//                       </th>
//                     </tr>
//                   </thead>
//                   <tbody>
//                     {history.map((s) => (
//                       <tr
//                         key={s.id}
//                         style={{ borderBottom: "1px solid #f0f0f0" }}
//                       >
//                         <td
//                           style={{
//                             padding: "20px 10px 20px 0",
//                             fontWeight: "600",
//                             color: "#111",
//                           }}
//                         >
//                           {s.filename}
//                         </td>
//                         <td style={{ padding: "20px 10px", color: "#555" }}>
//                           <div>
//                             {s.width}×{s.height}
//                           </div>
//                           <div style={{ fontSize: "13px", color: "#888" }}>
//                             {s.frames} frames @ {s.fps.toFixed(1)}fps
//                           </div>
//                         </td>
//                         <td style={{ padding: "20px 10px" }}>
//                           {s.trackers?.length ? (
//                             <span
//                               style={{
//                                 display: "inline-flex",
//                                 gap: "5px",
//                                 flexWrap: "wrap",
//                               }}
//                             >
//                               {s.trackers.map((t) => (
//                                 <span
//                                   key={t}
//                                   style={{
//                                     backgroundColor: "#f4f4f5",
//                                     padding: "3px 8px",
//                                     borderRadius: "4px",
//                                     fontSize: "13px",
//                                     fontWeight: "500",
//                                   }}
//                                 >
//                                   {t}
//                                 </span>
//                               ))}
//                             </span>
//                           ) : (
//                             <span
//                               style={{ color: "#999", fontStyle: "italic" }}
//                             >
//                               Uploaded only
//                             </span>
//                           )}
//                         </td>
//                         <td
//                           style={{
//                             padding: "20px 10px",
//                             fontWeight: "bold",
//                             color: s.summary ? "#111" : "#999",
//                           }}
//                         >
//                           {s.summary
//                             ? `${s.summary.average_fps.toFixed(1)}`
//                             : "—"}
//                         </td>
//                         <td
//                           style={{
//                             padding: "20px 10px",
//                             textAlign: "right",
//                             color: "#888",
//                             fontSize: "14px",
//                           }}
//                         >
//                           {new Date(s.created_at).toLocaleDateString(
//                             undefined,
//                             { year: "numeric", month: "short", day: "numeric" },
//                           )}
//                         </td>
//                       </tr>
//                     ))}
//                   </tbody>
//                 </table>
//               </div>
//             ) : (
//               <div className="results-placeholder">
//                 <b>No history found</b>
//                 <span>
//                   Run a comparison in the workspace to save a session.
//                 </span>
//               </div>
//             )}
//           </div>
//         )}

//         {/* --- EXPANDED GLOBAL BENCHMARKS VIEW --- */}
//         {activeView === "benchmarks" && (
//           <div
//             className="card results-card"
//             style={{ marginTop: "1rem", width: "100%" }}
//           >
//             <p
//               style={{
//                 color: "#666",
//                 marginBottom: "2rem",
//                 fontSize: "16px",
//                 lineHeight: "1.5",
//               }}
//             >
//               Aggregate performance metrics calculated dynamically from all
//               completed SOT runs in your MongoDB database.
//             </p>

//             <div
//               style={{
//                 display: "grid",
//                 gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
//                 gap: "1.5rem",
//               }}
//             >
//               {["CSRT", "KCF", "MOSSE", "GOTURN"].map((trackerName) => {
//                 const stats = history
//                   .flatMap((s) => s.results || [])
//                   .filter((r) => r.tracker === trackerName && r.fps);

//                 // Calculate aggregated metrics
//                 const totalRuns = stats.length;
//                 const avgFps = totalRuns
//                   ? (
//                       stats.reduce((acc, r) => acc + (r.fps || 0), 0) /
//                       totalRuns
//                     ).toFixed(1)
//                   : "0.0";
//                 const totalFrames = stats.reduce(
//                   (acc, r) => acc + (r.num_frames_processed || 0),
//                   0,
//                 );
//                 const totalFailures = stats.reduce(
//                   (acc, r) => acc + (r.failures || 0),
//                   0,
//                 );

//                 const reliability =
//                   totalFrames > 0
//                     ? (
//                         ((totalFrames - totalFailures) / totalFrames) *
//                         100
//                       ).toFixed(1)
//                     : "0.0";

//                 const tone =
//                   initialTrackers.find((t) => t.name === trackerName)?.tone ||
//                   "blue";

//                 return (
//                   <div
//                     key={trackerName}
//                     style={{
//                       border: "1px solid #eaeaea",
//                       borderRadius: "12px",
//                       padding: "1.5rem",
//                       display: "flex",
//                       flexDirection: "column",
//                       justifyContent: "space-between",
//                       backgroundColor: "#fff",
//                       boxShadow: "0 2px 8px rgba(0,0,0,0.02)",
//                     }}
//                   >
//                     <div
//                       style={{
//                         display: "flex",
//                         justifyContent: "space-between",
//                         alignItems: "center",
//                         marginBottom: "1.5rem",
//                       }}
//                     >
//                       <h3
//                         style={{
//                           margin: 0,
//                           fontSize: "18px",
//                           color: "#111",
//                           display: "flex",
//                           alignItems: "center",
//                           gap: "8px",
//                         }}
//                       >
//                         <span
//                           style={{
//                             display: "inline-block",
//                             width: "12px",
//                             height: "12px",
//                             borderRadius: "50%",
//                             backgroundColor: `var(--${tone})`,
//                           }}
//                         />
//                         {trackerName}
//                       </h3>
//                       <span
//                         style={{
//                           fontSize: "13px",
//                           backgroundColor: "#f4f4f5",
//                           padding: "4px 10px",
//                           borderRadius: "12px",
//                           color: "#555",
//                           fontWeight: "500",
//                         }}
//                       >
//                         {totalRuns} Runs
//                       </span>
//                     </div>

//                     <div
//                       style={{
//                         display: "grid",
//                         gridTemplateColumns: "1fr 1fr",
//                         gap: "1rem",
//                         marginBottom: "1rem",
//                       }}
//                     >
//                       <div
//                         style={{
//                           backgroundColor: "#fafafa",
//                           padding: "1rem",
//                           borderRadius: "8px",
//                         }}
//                       >
//                         <div
//                           style={{
//                             fontSize: "12px",
//                             color: "#888",
//                             marginBottom: "4px",
//                             textTransform: "uppercase",
//                             letterSpacing: "0.5px",
//                           }}
//                         >
//                           Avg Speed
//                         </div>
//                         <div
//                           style={{
//                             fontSize: "24px",
//                             fontWeight: "700",
//                             color: "#111",
//                           }}
//                         >
//                           {avgFps}{" "}
//                           <span
//                             style={{
//                               fontSize: "14px",
//                               fontWeight: "500",
//                               color: "#666",
//                             }}
//                           >
//                             FPS
//                           </span>
//                         </div>
//                       </div>
//                       <div
//                         style={{
//                           backgroundColor: "#fafafa",
//                           padding: "1rem",
//                           borderRadius: "8px",
//                         }}
//                       >
//                         <div
//                           style={{
//                             fontSize: "12px",
//                             color: "#888",
//                             marginBottom: "4px",
//                             textTransform: "uppercase",
//                             letterSpacing: "0.5px",
//                           }}
//                         >
//                           Reliability
//                         </div>
//                         <div
//                           style={{
//                             fontSize: "24px",
//                             fontWeight: "700",
//                             color: "#111",
//                           }}
//                         >
//                           {reliability}
//                           <span style={{ fontSize: "18px", fontWeight: "600" }}>
//                             %
//                           </span>
//                         </div>
//                       </div>
//                     </div>

//                     <div
//                       style={{
//                         display: "flex",
//                         justifyContent: "space-between",
//                         borderTop: "1px solid #eaeaea",
//                         paddingTop: "1rem",
//                         marginTop: "auto",
//                         fontSize: "13px",
//                         color: "#666",
//                       }}
//                     >
//                       <span>
//                         <b>{totalFrames.toLocaleString()}</b> total frames
//                       </span>
//                       <span>
//                         <b>{totalFailures.toLocaleString()}</b> failures
//                       </span>
//                     </div>
//                   </div>
//                 );
//               })}
//             </div>
//           </div>
//         )}
//       </section>
//     </main>
//   );
// }
