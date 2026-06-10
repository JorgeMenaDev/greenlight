/**
 * First-run setup screen, shown while GitHub Copilot is unauthenticated or
 * the Playwright Chromium browser is missing.
 */
import type { ReactNode } from "react";

import { useAppStore } from "../stores/appStore.ts";

interface ChecklistItemProps {
  ok: boolean;
  title: string;
  okLabel: string;
  children?: ReactNode;
}

const ChecklistItem = ({ ok, title, okLabel, children }: ChecklistItemProps) => (
  <div className={ok ? "setup-item setup-item-ok" : "setup-item"}>
    <div className="setup-item-head">
      <span className={ok ? "setup-check setup-check-ok" : "setup-check"}>{ok ? "✓" : "•"}</span>
      <h3>{title}</h3>
      {ok && <span className="setup-ok-label">{okLabel}</span>}
    </div>
    {!ok && <div className="setup-item-body">{children}</div>}
  </div>
);

export const OnboardingScreen = () => {
  const copilotStatus = useAppStore((state) => state.copilotStatus);
  const browserStatus = useAppStore((state) => state.browserStatus);
  const statusChecking = useAppStore((state) => state.statusChecking);
  const recheckStatuses = useAppStore((state) => state.recheckStatuses);
  const dismissOnboarding = useAppStore((state) => state.dismissOnboarding);

  const copilotOk = copilotStatus?.state === "authenticated";
  const browserOk = browserStatus?.state === "ready";

  return (
    <div className="gate">
      <div className="gate-card setup-card">
        <div className="brand brand-large">
          <span className="brand-dot" />
          Greenlight
        </div>
        <h2 className="setup-title">Almost ready</h2>
        <p className="setup-intro">
          Greenlight drives a real browser with an AI agent. Two things need to be in place before
          your first run:
        </p>

        <ChecklistItem
          ok={copilotOk}
          title="GitHub Copilot access"
          okLabel={
            copilotStatus?.login !== undefined ? `signed in as ${copilotStatus.login}` : "signed in"
          }
        >
          <p>
            The agent uses your GitHub Copilot subscription. Sign in with the GitHub CLI, then
            re-check:
          </p>
          <pre className="command">gh auth login</pre>
          {copilotStatus?.message !== undefined && (
            <p className="setup-detail">{copilotStatus.message}</p>
          )}
        </ChecklistItem>

        <ChecklistItem ok={browserOk} title="Playwright Chromium" okLabel="installed">
          <p>Steps are executed in a managed Chromium browser. Install it once:</p>
          <pre className="command">npx playwright install chromium</pre>
          {browserStatus?.detail !== undefined && (
            <p className="setup-detail">{browserStatus.detail}</p>
          )}
        </ChecklistItem>

        <div className="setup-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={statusChecking}
            onClick={() => {
              void recheckStatuses();
            }}
          >
            {statusChecking ? "Checking…" : "Re-check"}
          </button>
          <button type="button" className="link-button" onClick={dismissOnboarding}>
            Continue anyway
          </button>
        </div>
      </div>
    </div>
  );
};
