/**
 * PlaywrightTools - the browser toolset exposed to the step agent.
 *
 * Snapshot-first, ref-based interaction: `browser_snapshot` returns the
 * page's ARIA tree with element references ([ref=eN]); interaction tools
 * resolve those refs through Playwright's `aria-ref=` selector engine.
 * The mandatory `report_step_result` tool is how the agent delivers a
 * verdict for the current step.
 *
 * Handlers return error text instead of throwing so the agent can read
 * what went wrong and adapt.
 *
 * @module PlaywrightTools
 */
import type { Page } from "playwright";

import type { StepVerdict } from "@greenlight/contracts";

import { stringArg, toolArgs, type AgentTool } from "./AgentTool.ts";

const SNAPSHOT_MAX_CHARS = 24_000;
const EVALUATE_MAX_CHARS = 2_000;
const ACTION_TIMEOUT_MS = 5_000;
const NAVIGATION_TIMEOUT_MS = 15_000;
const WAIT_MAX_MS = 10_000;

export interface VerdictSlot {
  current: StepVerdict | null;
}

export interface ToolActivity {
  readonly tool: string;
  readonly summary: string;
}

export interface ToolContext {
  readonly page: Page;
  readonly baseUrl: string;
  /** Live narration callback; must never throw. */
  readonly onActivity: (activity: ToolActivity) => void;
  /** Persist a screenshot, returning a short identifier shown to the agent. */
  readonly saveScreenshot: (label: string, data: Uint8Array) => Promise<string>;
  /** Verdict slot for the current step; reset by the engine before each step. */
  readonly verdict: VerdictSlot;
  /** Per-step tool-call budget; reset by the engine before each step. */
  readonly budget: { remaining: number };
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message.split("\n")[0]! : String(error);

const ref = (page: Page, refId: string) => page.locator(`aria-ref=${refId}`);

export const makePlaywrightTools = (ctx: ToolContext): ReadonlyArray<AgentTool> => {
  const { page } = ctx;

  const consoleBuffer: Array<string> = [];
  page.on("console", (message) => {
    consoleBuffer.push(`[${message.type()}] ${message.text()}`);
    if (consoleBuffer.length > 200) consoleBuffer.shift();
  });

  const guarded = (
    tool: string,
    summarize: (args: Record<string, unknown>) => string,
    run: (args: Record<string, unknown>) => Promise<string>,
  ): AgentTool["handler"] => {
    return async (rawArgs) => {
      const args = toolArgs(rawArgs);
      ctx.onActivity({ tool, summary: summarize(args) });
      if (ctx.budget.remaining <= 0) {
        return "Tool budget for this step is exhausted. Call report_step_result now with your best honest verdict.";
      }
      ctx.budget.remaining -= 1;
      try {
        return await run(args);
      } catch (error) {
        return `Error: ${errorText(error)}`;
      }
    };
  };

  const snapshot = async (): Promise<string> => {
    const tree = await page.ariaSnapshot({ mode: "ai" });
    const body =
      tree.length > SNAPSHOT_MAX_CHARS
        ? `${tree.slice(0, SNAPSHOT_MAX_CHARS)}\n[snapshot truncated]`
        : tree;
    return `Page URL: ${page.url()}\nPage title: ${await page.title()}\n\n${body}`;
  };

  const refParams = {
    ref: {
      type: "string",
      description: "Element reference from the latest browser_snapshot, e.g. \"e12\"",
    },
    element: {
      type: "string",
      description: "Human-readable description of the element, for the test log",
    },
  } as const;

  const tools: Array<AgentTool> = [
    {
      name: "browser_navigate",
      description:
        "Navigate to a URL. Relative URLs resolve against the application under test.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
        additionalProperties: false,
      },
      handler: guarded(
        "browser_navigate",
        (args) => `navigate to ${stringArg(args, "url")}`,
        async (args) => {
          const target = new URL(stringArg(args, "url"), ctx.baseUrl).toString();
          await page.goto(target, { timeout: NAVIGATION_TIMEOUT_MS });
          return `Navigated to ${page.url()} ("${await page.title()}")`;
        },
      ),
    },
    {
      name: "browser_snapshot",
      description:
        "Read the current page as an accessibility tree with element refs. Use this to see what is on the page before and after interacting.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      handler: guarded(
        "browser_snapshot",
        () => "read page snapshot",
        () => snapshot(),
      ),
    },
    {
      name: "browser_click",
      description: "Click an element identified by a snapshot ref.",
      parameters: {
        type: "object",
        properties: { ...refParams },
        required: ["ref", "element"],
        additionalProperties: false,
      },
      handler: guarded(
        "browser_click",
        (args) => `click ${stringArg(args, "element")}`,
        async (args) => {
          await ref(page, stringArg(args, "ref")).click({ timeout: ACTION_TIMEOUT_MS });
          return `Clicked ${stringArg(args, "element")}.`;
        },
      ),
    },
    {
      name: "browser_type",
      description:
        "Type text into an input identified by a snapshot ref, optionally submitting with Enter.",
      parameters: {
        type: "object",
        properties: {
          ...refParams,
          text: { type: "string" },
          submit: { type: "boolean", description: "Press Enter after typing" },
        },
        required: ["ref", "element", "text"],
        additionalProperties: false,
      },
      handler: guarded(
        "browser_type",
        (args) => `type "${stringArg(args, "text")}" into ${stringArg(args, "element")}`,
        async (args) => {
          const locator = ref(page, stringArg(args, "ref"));
          await locator.fill(stringArg(args, "text"), { timeout: ACTION_TIMEOUT_MS });
          if (args["submit"] === true) {
            await locator.press("Enter", { timeout: ACTION_TIMEOUT_MS });
            return `Typed and submitted "${stringArg(args, "text")}".`;
          }
          return `Typed "${stringArg(args, "text")}".`;
        },
      ),
    },
    {
      name: "browser_select_option",
      description: "Select option(s) in a <select> identified by a snapshot ref.",
      parameters: {
        type: "object",
        properties: {
          ...refParams,
          values: { type: "array", items: { type: "string" } },
        },
        required: ["ref", "element", "values"],
        additionalProperties: false,
      },
      handler: guarded(
        "browser_select_option",
        (args) => `select option in ${stringArg(args, "element")}`,
        async (args) => {
          const values = Array.isArray(args["values"])
            ? args["values"].filter((value): value is string => typeof value === "string")
            : [];
          await ref(page, stringArg(args, "ref")).selectOption(values, {
            timeout: ACTION_TIMEOUT_MS,
          });
          return `Selected ${values.join(", ")}.`;
        },
      ),
    },
    {
      name: "browser_press_key",
      description: "Press a keyboard key (e.g. Enter, Escape, ArrowDown).",
      parameters: {
        type: "object",
        properties: { key: { type: "string" } },
        required: ["key"],
        additionalProperties: false,
      },
      handler: guarded(
        "browser_press_key",
        (args) => `press ${stringArg(args, "key")}`,
        async (args) => {
          await page.keyboard.press(stringArg(args, "key"));
          return `Pressed ${stringArg(args, "key")}.`;
        },
      ),
    },
    {
      name: "browser_hover",
      description: "Hover over an element identified by a snapshot ref.",
      parameters: {
        type: "object",
        properties: { ...refParams },
        required: ["ref", "element"],
        additionalProperties: false,
      },
      handler: guarded(
        "browser_hover",
        (args) => `hover ${stringArg(args, "element")}`,
        async (args) => {
          await ref(page, stringArg(args, "ref")).hover({ timeout: ACTION_TIMEOUT_MS });
          return `Hovering ${stringArg(args, "element")}.`;
        },
      ),
    },
    {
      name: "browser_scroll",
      description: "Scroll the page, or scroll a ref'd element into view.",
      parameters: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["up", "down"] },
          ref: { type: "string", description: "Optional element ref to scroll into view" },
        },
        additionalProperties: false,
      },
      handler: guarded(
        "browser_scroll",
        (args) =>
          stringArg(args, "ref") !== ""
            ? "scroll element into view"
            : `scroll ${stringArg(args, "direction") || "down"}`,
        async (args) => {
          const refId = stringArg(args, "ref");
          if (refId !== "") {
            await ref(page, refId).scrollIntoViewIfNeeded({ timeout: ACTION_TIMEOUT_MS });
            return "Scrolled element into view.";
          }
          const delta = stringArg(args, "direction") === "up" ? -600 : 600;
          await page.mouse.wheel(0, delta);
          return "Scrolled.";
        },
      ),
    },
    {
      name: "browser_wait_for",
      description:
        "Wait for text to appear or disappear, or for a fixed time (max 10s). Use sparingly.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Wait until this text is visible" },
          textGone: { type: "string", description: "Wait until this text disappears" },
          timeMs: { type: "number", description: "Fixed wait in milliseconds" },
        },
        additionalProperties: false,
      },
      handler: guarded(
        "browser_wait_for",
        () => "wait",
        async (args) => {
          const text = stringArg(args, "text");
          const textGone = stringArg(args, "textGone");
          if (text !== "") {
            await page.getByText(text).first().waitFor({ state: "visible", timeout: WAIT_MAX_MS });
            return `"${text}" is visible.`;
          }
          if (textGone !== "") {
            await page
              .getByText(textGone)
              .first()
              .waitFor({ state: "hidden", timeout: WAIT_MAX_MS });
            return `"${textGone}" is gone.`;
          }
          const timeMs = Math.min(
            typeof args["timeMs"] === "number" ? args["timeMs"] : 1_000,
            WAIT_MAX_MS,
          );
          await page.waitForTimeout(timeMs);
          return `Waited ${timeMs}ms.`;
        },
      ),
    },
    {
      name: "browser_screenshot",
      description: "Capture a screenshot of the current page as evidence.",
      parameters: {
        type: "object",
        properties: { label: { type: "string" } },
        additionalProperties: false,
      },
      handler: guarded(
        "browser_screenshot",
        (args) => `screenshot ${stringArg(args, "label")}`.trim(),
        async (args) => {
          const data = await page.screenshot({ type: "png" });
          const id = await ctx.saveScreenshot(stringArg(args, "label") || "screenshot", data);
          return `Screenshot saved (${id}).`;
        },
      ),
    },
    {
      name: "browser_console_messages",
      description: "Read recent browser console messages.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      handler: guarded(
        "browser_console_messages",
        () => "read console",
        async () =>
          consoleBuffer.length === 0 ? "No console messages." : consoleBuffer.join("\n"),
      ),
    },
    {
      name: "browser_evaluate",
      description:
        "Escape hatch: evaluate a JavaScript expression in the page and return the JSON-stringified result.",
      parameters: {
        type: "object",
        properties: { expression: { type: "string" } },
        required: ["expression"],
        additionalProperties: false,
      },
      handler: guarded(
        "browser_evaluate",
        () => "evaluate JavaScript",
        async (args) => {
          const result = await page.evaluate(stringArg(args, "expression"));
          const text = JSON.stringify(result) ?? "undefined";
          return text.length > EVALUATE_MAX_CHARS
            ? `${text.slice(0, EVALUATE_MAX_CHARS)}… [truncated]`
            : text;
        },
      ),
    },
    {
      name: "report_step_result",
      description:
        "Report the verdict for the current step. Call exactly once per step when the step is complete or has failed.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["passed", "failed"] },
          summary: { type: "string", description: "What was done / observed" },
          expected: { type: "string", description: "For failed assertions: what was expected" },
          actual: { type: "string", description: "For failed assertions: what was actually seen" },
        },
        required: ["status", "summary"],
        additionalProperties: false,
      },
      handler: async (rawArgs) => {
        const args = toolArgs(rawArgs);
        ctx.onActivity({
          tool: "report_step_result",
          summary: `verdict: ${stringArg(args, "status")}`,
        });
        if (ctx.verdict.current !== null) {
          return "A verdict was already recorded for this step.";
        }
        const status = stringArg(args, "status");
        const summary = stringArg(args, "summary");
        if ((status !== "passed" && status !== "failed") || summary === "") {
          return 'Invalid verdict: status must be "passed" or "failed" and summary is required.';
        }
        const expected = stringArg(args, "expected");
        const actual = stringArg(args, "actual");
        ctx.verdict.current = {
          status,
          summary,
          ...(expected !== "" ? { expected } : {}),
          ...(actual !== "" ? { actual } : {}),
        };
        return "Verdict recorded.";
      },
    },
  ];

  return tools;
};
