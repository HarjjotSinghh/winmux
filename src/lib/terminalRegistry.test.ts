import { beforeEach, describe, expect, it } from "vitest";
import {
  getTerminal,
  registerTerminal,
  unregisterTerminal,
} from "./terminalRegistry";
import type { TerminalHandle } from "./terminalRegistry";

function fakeHandle(): TerminalHandle {
  return {
    term: { focus: () => {} } as unknown as TerminalHandle["term"],
    search: {} as unknown as TerminalHandle["search"],
  };
}

describe("terminalRegistry", () => {
  beforeEach(() => {
    unregisterTerminal("term-a");
    unregisterTerminal("term-b");
  });

  it("returns null for unknown or empty ids", () => {
    expect(getTerminal(null)).toBeNull();
    expect(getTerminal(undefined)).toBeNull();
    expect(getTerminal("")).toBeNull();
    expect(getTerminal("missing")).toBeNull();
  });

  it("registers and resolves a handle", () => {
    const handle = fakeHandle();
    registerTerminal("term-a", handle);
    expect(getTerminal("term-a")).toBe(handle);
  });

  it("unregisters a handle", () => {
    registerTerminal("term-a", fakeHandle());
    unregisterTerminal("term-a");
    expect(getTerminal("term-a")).toBeNull();
  });

  it("replacing a handle wins", () => {
    const first = fakeHandle();
    const second = fakeHandle();
    registerTerminal("term-a", first);
    registerTerminal("term-a", second);
    expect(getTerminal("term-a")).toBe(second);
  });
});
