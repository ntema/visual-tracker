"use client";

import AuthModal from "./AuthModal";

type Props = {
  showAuth: boolean;
  authMode: "login" | "register";
  name: string;
  email: string;
  password: string;
  authError: string;
  busy: boolean;
  onOpenAuth: (mode: "login" | "register") => void;
  onCloseAuth: () => void;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onModeChange: (mode: "login" | "register") => void;
  onSubmit: (e: React.FormEvent) => void;
};

const features = [
  {
    icon: "◈",
    title: "Side-by-side comparison",
    text: "Run CSRT, KCF, MOSSE and GOTURN on the same video with identical initialization.",
  },
  {
    icon: "⬚",
    title: "Interactive bounding box",
    text: "Draw or enter the initial target region and evaluate trackers under the same starting conditions.",
  },
  {
    icon: "◷",
    title: "Metrics & sessions",
    text: "Track precision, success AUC, FPS and failure cases. Revisit past sessions anytime.",
  },
  {
    icon: "◎",
    title: "Academic-ready workflow",
    text: "Built for OTB/VOT-style evaluation with optional ground-truth upload for formal benchmarks.",
  },
];

const trackers = [
  { name: "CSRT", desc: "Robust to deformation", color: "#6555e8" },
  { name: "KCF", desc: "Fast & reliable", color: "#3b82f6" },
  { name: "MOSSE", desc: "Ultra-lightweight", color: "#f59e0b" },
  { name: "GOTURN", desc: "Deep regression", color: "#10b981" },
];

export default function LandingPage({
  showAuth,
  authMode,
  name,
  email,
  password,
  authError,
  busy,
  onOpenAuth,
  onCloseAuth,
  onNameChange,
  onEmailChange,
  onPasswordChange,
  onModeChange,
  onSubmit,
}: Props) {
  return (
    <div className="landing-root">
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <div className="landing-brand">
            <span className="brand-mark">V</span>
            <span>
              VisualTracker <b>Studio</b>
            </span>
          </div>
          <div className="landing-nav-actions">
            <button
              type="button"
              className="landing-ghost-btn"
              onClick={() => onOpenAuth("login")}
            >
              Sign In
            </button>
            <button
              type="button"
              className="landing-primary-btn landing-nav-cta"
              onClick={() => onOpenAuth("register")}
            >
              Get Started
            </button>
          </div>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-badge">
          Comparative Single-Object Tracking Platform
        </div>
        <h1 className="landing-hero-title">
          Compare classical and deep
          <br />
          <span className="landing-gradient">trackers in one workspace</span>
        </h1>
        <p className="landing-hero-text">
          Upload a video, initialize a target bounding box, and evaluate CSRT,
          KCF, MOSSE and GOTURN side by side — with metrics, trajectories and
          session history built for research and teaching.
        </p>
        <div className="landing-hero-actions">
          <button
            type="button"
            className="landing-primary-btn landing-hero-cta"
            onClick={() => onOpenAuth("register")}
          >
            Start comparing trackers
          </button>
          <button
            type="button"
            className="landing-ghost-btn landing-hero-secondary"
            onClick={() => onOpenAuth("login")}
          >
            Sign in to workspace
          </button>
        </div>

        <div className="landing-tracker-row">
          {trackers.map((t) => (
            <div key={t.name} className="landing-tracker-chip">
              <span
                className="landing-tracker-dot"
                style={{ background: t.color }}
              />
              <div>
                <strong>{t.name}</strong>
                <span>{t.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-features">
        <div className="landing-section-label">Why VisualTracker Studio</div>
        <h2 className="landing-section-title">
          From offline scripts to an interactive lab
        </h2>
        <div className="landing-feature-grid">
          {features.map((f) => (
            <article key={f.title} className="landing-feature-card">
              <div className="landing-feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-cta-band">
        <div className="landing-cta-inner">
          <h2>Ready to evaluate your next sequence?</h2>
          <p>
            Create an account, upload a video, and run multi-tracker comparison
            in minutes.
          </p>
          <button
            type="button"
            className="landing-primary-btn landing-hero-cta"
            onClick={() => onOpenAuth("register")}
          >
            Create free account
          </button>
        </div>
      </section>

      <footer className="landing-footer">
        <span>VisualTracker Studio</span>
        <span>B.Sc Final Year Project · Comparative SOT Platform</span>
      </footer>

      {showAuth && (
        <AuthModal
          authMode={authMode}
          name={name}
          email={email}
          password={password}
          authError={authError}
          busy={busy}
          onNameChange={onNameChange}
          onEmailChange={onEmailChange}
          onPasswordChange={onPasswordChange}
          onModeChange={onModeChange}
          onSubmit={onSubmit}
          onClose={onCloseAuth}
        />
      )}
    </div>
  );
}
