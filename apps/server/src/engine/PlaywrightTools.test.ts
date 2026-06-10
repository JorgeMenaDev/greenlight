import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as NodePath from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "playwright";

import { makePlaywrightTools, type ToolContext, type VerdictSlot } from "./PlaywrightTools.ts";
import type { AgentTool } from "./AgentTool.ts";

const fixtureUrl = pathToFileURL(
  NodePath.join(import.meta.dirname, "fixtures", "todo.html"),
).toString();

let browser: Browser;
let page: Page;
let tools: ReadonlyArray<AgentTool>;
let verdict: VerdictSlot;
let budget: { remaining: number };
const activities: Array<string> = [];
const screenshots: Array<string> = [];

const tool = (name: string): AgentTool => {
  const found = tools.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
};

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(fixtureUrl);
  verdict = { current: null };
  budget = { remaining: 100 };
  const ctx: ToolContext = {
    page,
    baseUrl: fixtureUrl,
    onActivity: (activity) => activities.push(`${activity.tool}: ${activity.summary}`),
    saveScreenshot: async (label) => {
      screenshots.push(label);
      return `shot-${screenshots.length}`;
    },
    verdict,
    budget,
  };
  tools = makePlaywrightTools(ctx);
});

afterAll(async () => {
  await browser?.close();
});

describe("PlaywrightTools (real browser)", () => {
  it("snapshot returns the accessibility tree with refs", async () => {
    const result = await tool("browser_snapshot").handler({});
    expect(result).toContain("Tiny Todo");
    expect(result).toMatch(/\[ref=e\d+\]/);
  });

  it("type + click via refs mutates the page", async () => {
    const snapshot = await tool("browser_snapshot").handler({});
    const inputRef = /textbox[^\n]*\[ref=(e\d+)\]/.exec(snapshot)?.[1];
    const buttonRef = /button[^\n]*\[ref=(e\d+)\]/.exec(snapshot)?.[1];
    expect(inputRef).toBeDefined();
    expect(buttonRef).toBeDefined();

    await tool("browser_type").handler({
      ref: inputRef,
      element: "new todo input",
      text: "buy milk",
    });
    await tool("browser_click").handler({ ref: buttonRef, element: "add button" });

    const after = await tool("browser_snapshot").handler({});
    expect(after).toContain("buy milk");
  });

  it("console messages are captured", async () => {
    const messages = await tool("browser_console_messages").handler({});
    expect(messages).toContain("added todo: buy milk");
  });

  it("evaluate returns JSON results", async () => {
    const result = await tool("browser_evaluate").handler({
      expression: "document.querySelectorAll('#list li').length",
    });
    expect(result).toBe("1");
  });

  it("screenshot persists through the context callback", async () => {
    const result = await tool("browser_screenshot").handler({ label: "test" });
    expect(result).toContain("shot-");
    expect(screenshots).toContain("test");
  });

  it("interaction errors come back as text instead of throwing", async () => {
    const result = await tool("browser_click").handler({
      ref: "e9999",
      element: "nonexistent",
    });
    expect(result).toMatch(/^Error:/);
  });

  it("report_step_result fills the verdict slot once", async () => {
    expect(verdict.current).toBeNull();
    const first = await tool("report_step_result").handler({
      status: "failed",
      summary: "it broke",
      expected: "a result",
      actual: "nothing",
    });
    expect(first).toBe("Verdict recorded.");
    expect(verdict.current).toEqual({
      status: "failed",
      summary: "it broke",
      expected: "a result",
      actual: "nothing",
    });
    const second = await tool("report_step_result").handler({
      status: "passed",
      summary: "again",
    });
    expect(second).toContain("already recorded");
    expect(verdict.current?.status).toBe("failed");
  });

  it("budget exhaustion tells the agent to report", async () => {
    budget.remaining = 0;
    const result = await tool("browser_snapshot").handler({});
    expect(result).toContain("budget");
    budget.remaining = 100;
  });
});
