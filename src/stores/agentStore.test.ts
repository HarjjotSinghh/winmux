import { beforeEach, describe, expect, it } from "vitest";
import { useAgentStore } from "./agentStore";

function reset() {
  useAgentStore.setState({ unread: {}, statuses: {}, queue: [] });
}

describe("agentStore", () => {
  beforeEach(reset);

  it("increments per-terminal and infers needs_input", () => {
    useAgentStore.getState().incrementForTerminal("t1", "Claude", "needs input waiting");
    expect(useAgentStore.getState().unread["t1"]).toBe(1);
    expect(useAgentStore.getState().statuses["t1"]).toBe("needs_input");
    expect(useAgentStore.getState().queue).toEqual(["t1"]);
  });

  it("accumulates counts", () => {
    const s = useAgentStore.getState();
    s.incrementForTerminal("t1", "x", "y");
    s.incrementForTerminal("t1", "x", "y");
    expect(useAgentStore.getState().unread["t1"]).toBe(2);
    expect(useAgentStore.getState().queue).toEqual(["t1"]);
  });

  it("clearForTerminal removes", () => {
    const s = useAgentStore.getState();
    s.incrementForTerminal("t1", "a", "b");
    s.incrementForTerminal("t2", "a", "b");
    s.clearForTerminal("t1");
    expect(useAgentStore.getState().unread["t1"]).toBeUndefined();
    expect(useAgentStore.getState().queue).toEqual(["t2"]);
  });

  it("next/prev cycles", () => {
    const s = useAgentStore.getState();
    s.incrementForTerminal("t1", "a", "b");
    s.incrementForTerminal("t2", "a", "b");
    s.incrementForTerminal("t3", "a", "b");
    expect(s.nextUnread("t1")).toBe("t2");
    expect(s.nextUnread("t3")).toBe("t1");
    expect(s.prevUnread("t1")).toBe("t3");
    expect(s.nextUnread(null)).toBe("t1");
    expect(s.prevUnread(null)).toBe("t3");
  });

  it("infers working", () => {
    useAgentStore.getState().incrementForTerminal("t1", "Agent", "working on task");
    expect(useAgentStore.getState().statuses["t1"]).toBe("working");
  });

  it("evicting a dead head unblocks cycling to live panes", () => {
    const s = useAgentStore.getState();
    s.incrementForTerminal("dead-1", "a", "b");
    s.incrementForTerminal("live-2", "a", "b");
    s.incrementForTerminal("dead-3", "a", "b");

    // Simulate the App cycle loop: jump to head fails (terminal gone),
    // evict it, then the next head must be the live one.
    expect(useAgentStore.getState().nextUnread(null)).toBe("dead-1");
    useAgentStore.getState().clearForTerminal("dead-1");
    expect(useAgentStore.getState().nextUnread(null)).toBe("live-2");
    expect(useAgentStore.getState().queue).toEqual(["live-2", "dead-3"]);
  });

  it("clearing every entry empties the cycler", () => {
    const s = useAgentStore.getState();
    s.incrementForTerminal("t1", "a", "b");
    s.clearForTerminal("t1");
    expect(s.nextUnread("t1")).toBeNull();
    expect(s.prevUnread(null)).toBeNull();
    expect(s.queue).toEqual([]);
  });
});
