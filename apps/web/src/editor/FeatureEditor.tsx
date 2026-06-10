/**
 * Gherkin editor built on CodeMirror 6.
 *
 * - StreamLanguage wrapping the legacy gherkin mode, one-dark theme.
 * - Cmd/Ctrl+S saves via `features.write`; parse errors come back as lint
 *   diagnostics and a banner.
 * - Each parsed scenario gets a "Run scenario" button.
 */
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { StreamLanguage } from "@codemirror/language";
import { gherkin } from "@codemirror/legacy-modes/mode/gherkin";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import type { GherkinParseError } from "@greenlight/contracts";
import { useEffect, useRef, useState } from "react";

import { errorMessage, rpc } from "../rpc/client.ts";
import { useAppStore } from "../stores/appStore.ts";
import { startRunWithConfig, useRunStore } from "../stores/runStore.ts";

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.6",
  },
  "&.cm-focused": {
    outline: "none",
  },
});

const toDiagnostics = (
  view: EditorView,
  errors: ReadonlyArray<GherkinParseError>,
): Array<Diagnostic> => {
  const doc = view.state.doc;
  return errors.map((error) => {
    const lineNumber = Math.min(Math.max(error.line ?? 1, 1), doc.lines);
    const line = doc.line(lineNumber);
    const column = Math.max((error.column ?? 1) - 1, 0);
    const from = Math.min(line.from + column, line.to);
    return { from, to: line.to, severity: "error" as const, message: error.detail };
  });
};

export const FeatureEditor = () => {
  const path = useAppStore((state) => state.selectedFeaturePath);
  const parsed = useAppStore((state) => state.parsed);
  const setParsed = useAppStore((state) => state.setParsed);
  const runBusy = useRunStore((state) => state.live || state.starting);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const pathRef = useRef<string | undefined>(path);
  const savingRef = useRef(false);

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  pathRef.current = path;

  const saveRef = useRef<() => Promise<void>>(async () => {});
  saveRef.current = async () => {
    const view = viewRef.current;
    const currentPath = pathRef.current;
    if (view === null || currentPath === undefined || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const content = view.state.doc.toString();
      const result = await rpc("features.write", { path: currentPath, content });
      setParsed(result.parsed);
      setDirty(false);
      setSaveError(undefined);
      view.dispatch(setDiagnostics(view.state, toDiagnostics(view, result.parsed.errors)));
    } catch (error) {
      setSaveError(errorMessage(error));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  useEffect(() => {
    const host = hostRef.current;
    if (host === null || path === undefined) return;

    let disposed = false;
    setLoading(true);
    setLoadError(undefined);
    setSaveError(undefined);
    setDirty(false);

    void rpc("features.read", { path })
      .then(({ content, parsed: parseResult }) => {
        if (disposed) return;
        setParsed(parseResult);
        const view = new EditorView({
          state: EditorState.create({
            doc: content,
            extensions: [
              lineNumbers(),
              highlightActiveLineGutter(),
              highlightActiveLine(),
              history(),
              EditorView.lineWrapping,
              StreamLanguage.define(gherkin),
              oneDark,
              editorTheme,
              lintGutter(),
              keymap.of([
                {
                  key: "Mod-s",
                  preventDefault: true,
                  run: () => {
                    void saveRef.current();
                    return true;
                  },
                },
                indentWithTab,
                ...defaultKeymap,
                ...historyKeymap,
              ]),
              EditorView.updateListener.of((update) => {
                if (update.docChanged) setDirty(true);
              }),
            ],
          }),
          parent: host,
        });
        viewRef.current = view;
        view.dispatch(setDiagnostics(view.state, toDiagnostics(view, parseResult.errors)));
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setLoadError(errorMessage(error));
          setLoading(false);
        }
      });

    return () => {
      disposed = true;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [path, setParsed]);

  if (path === undefined) {
    return (
      <div className="editor-pane">
        <div className="panel-empty">
          <p>No feature selected.</p>
          <p className="muted">Pick a feature file in the sidebar, or create a new one.</p>
        </div>
      </div>
    );
  }

  const parseErrors = parsed?.errors ?? [];
  const scenarios = parsed?.feature?.scenarios ?? [];

  return (
    <div className="editor-pane">
      <div className="editor-head">
        <span className="editor-path" title={path}>
          {path}
          {dirty && <span className="dirty-dot" title="Unsaved changes" />}
        </span>
        <span className="editor-hint">
          {saving ? "Saving…" : dirty ? "Unsaved — press ⌘S / Ctrl+S to save" : "Saved"}
        </span>
      </div>

      {loadError !== undefined && <div className="banner banner-error">{loadError}</div>}
      {saveError !== undefined && <div className="banner banner-error">{saveError}</div>}
      {parseErrors.length > 0 && (
        <div className="banner banner-error">
          <strong>Gherkin parse {parseErrors.length === 1 ? "error" : "errors"}:</strong>{" "}
          {parseErrors
            .map((error) =>
              error.line !== undefined ? `line ${error.line}: ${error.detail}` : error.detail,
            )
            .join(" · ")}
        </div>
      )}

      <div className="editor-host" ref={hostRef}>
        {loading && <div className="editor-loading pulse">Loading…</div>}
      </div>

      {scenarios.length > 0 && (
        <div className="scenario-strip">
          <span className="scenario-strip-label">
            {scenarios.length} scenario{scenarios.length === 1 ? "" : "s"}
          </span>
          <ul className="scenario-chips">
            {scenarios.map((scenario) => (
              <li key={scenario.pickleId}>
                <button
                  type="button"
                  className="scenario-chip"
                  disabled={runBusy}
                  title={`Run scenario: ${scenario.name}`}
                  onClick={() => {
                    startRunWithConfig([scenario.pickleId]);
                  }}
                >
                  <span className="chip-play">▶</span>
                  {scenario.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
