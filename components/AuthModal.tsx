"use client";

type Props = {
  authMode: "login" | "register";
  email: string;
  password: string;
  authError: string;
  busy: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onModeChange: (mode: "login" | "register") => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
};

export default function AuthModal({
  authMode,
  email,
  password,
  authError,
  busy,
  onEmailChange,
  onPasswordChange,
  onModeChange,
  onSubmit,
  onClose,
}: Props) {
  return (
    <div className="landing-modal-overlay" onClick={onClose}>
      <div className="landing-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="landing-modal-close" onClick={onClose}>
          ×
        </button>

        <div className="landing-modal-brand">
          <span className="brand-mark">V</span>
          <span>
            VisualTracker <b>Studio</b>
          </span>
        </div>

        <h2 className="landing-modal-title">
          {authMode === "login" ? "Welcome back" : "Create your account"}
        </h2>
        <p className="landing-modal-subtitle">
          {authMode === "login"
            ? "Sign in to continue comparing trackers."
            : "Start evaluating single-object trackers in minutes."}
        </p>

        {authError && <div className="landing-auth-error">{authError}</div>}

        <form onSubmit={onSubmit} className="landing-auth-form">
          <label className="landing-label">
            Email Address
            <input
              type="email"
              required
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              placeholder="you@university.edu"
              className="landing-input"
            />
          </label>

          <label className="landing-label">
            Password
            <input
              type="password"
              required
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              placeholder="••••••••"
              className="landing-input"
            />
          </label>

          <button type="submit" className="landing-primary-btn" disabled={busy}>
            {busy
              ? "Please wait..."
              : authMode === "login"
                ? "Sign In"
                : "Create Account"}
          </button>
        </form>

        <p className="landing-switch">
          {authMode === "login"
            ? "Don't have an account? "
            : "Already have an account? "}
          <button
            type="button"
            className="landing-link-btn"
            onClick={() =>
              onModeChange(authMode === "login" ? "register" : "login")
            }
          >
            {authMode === "login" ? "Register" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
