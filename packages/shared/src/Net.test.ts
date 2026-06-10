import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";

import { make } from "./Net.ts";

describe("Net", () => {
  it("findAvailablePort returns a usable port", async () => {
    const net = make();
    const port = await Effect.runPromise(net.findAvailablePort(0));
    expect(port).toBeGreaterThan(0);
  });

  it("reserveLoopbackPort returns a loopback port", async () => {
    const net = make();
    const port = await Effect.runPromise(net.reserveLoopbackPort());
    expect(port).toBeGreaterThan(0);
  });

  it("isPortAvailableOnLoopback is true for a freshly reserved port", async () => {
    const net = make();
    const result = await Effect.runPromise(
      Effect.flatMap(net.reserveLoopbackPort(), (port) => net.isPortAvailableOnLoopback(port)),
    );
    expect(result).toBe(true);
  });
});
