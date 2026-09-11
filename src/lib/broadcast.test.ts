import { beforeEach, describe, expect, it } from "vitest";
import {
  getBroadcastTargets,
  setBroadcastTargetsProvider,
} from "./broadcast";

describe("broadcast", () => {
  beforeEach(() => {
    setBroadcastTargetsProvider(null);
  });

  it("returns no targets when no provider is registered", () => {
    expect(getBroadcastTargets("t1")).toEqual([]);
  });

  it("returns no targets for an empty id", () => {
    setBroadcastTargetsProvider(() => ["t1", "t2"]);
    expect(getBroadcastTargets("")).toEqual([]);
  });

  it("excludes the source terminal", () => {
    setBroadcastTargetsProvider(() => ["t1", "t2", "t3"]);
    expect(getBroadcastTargets("t1")).toEqual(["t2", "t3"]);
  });

  it("drops blank ids and survives provider errors", () => {
    setBroadcastTargetsProvider(() => ["", "t2"]);
    expect(getBroadcastTargets("t1")).toEqual(["t2"]);
    setBroadcastTargetsProvider(() => {
      throw new Error("boom");
    });
    expect(getBroadcastTargets("t1")).toEqual([]);
  });
});
