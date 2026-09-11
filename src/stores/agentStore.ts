import { create } from "zustand";

export type AgentStatus = "idle" | "working" | "needs_input";

interface AgentStore {
  /** terminalId -> unread notification count */
  unread: Record<string, number>;
  /** terminalId -> current agent status */
  statuses: Record<string, AgentStatus>;
  /** ordered list of terminalIds that currently have unread */
  queue: string[];

  setStatus: (terminalId: string, status: AgentStatus) => void;
  incrementForTerminal: (terminalId: string, title: string, body: string) => void;
  clearForTerminal: (terminalId: string) => void;
  clearAll: () => void;
  nextUnread: (currentTerminalId: string | null) => string | null;
  prevUnread: (currentTerminalId: string | null) => string | null;
}

function inferStatus(title: string, body: string): AgentStatus {
  const text = `${title} ${body}`.toLowerCase();
  if (
    text.includes("needs") ||
    text.includes("waiting") ||
    text.includes("prompt") ||
    text.includes("question") ||
    text.includes("confirm") ||
    text.includes("input")
  ) {
    return "needs_input";
  }
  // Generic notifications are considered 'needs_input' as well to surface
  // attention; but if title explicitly says working/busy, keep working.
  if (text.includes("working") || text.includes("busy") || text.includes("running")) {
    return "working";
  }
  return "needs_input";
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  unread: {},
  statuses: {},
  queue: [],

  setStatus: (terminalId, status) =>
    set((s) => ({ statuses: { ...s.statuses, [terminalId]: status } })),

  incrementForTerminal: (terminalId, title, body) => {
    const status = inferStatus(title, body);
    set((s) => {
      const nextUnread = { ...s.unread, [terminalId]: (s.unread[terminalId] ?? 0) + 1 };
      const nextStatuses = { ...s.statuses, [terminalId]: status };
      const nextQueue = s.queue.includes(terminalId) ? s.queue : [...s.queue, terminalId];
      return { unread: nextUnread, statuses: nextStatuses, queue: nextQueue };
    });
  },

  clearForTerminal: (terminalId) =>
    set((s) => {
      const { [terminalId]: _omit, ...restUnread } = s.unread;
      const { [terminalId]: _omitStatus, ...restStatuses } = s.statuses;
      return {
        unread: restUnread,
        statuses: restStatuses,
        queue: s.queue.filter((id) => id !== terminalId),
      };
    }),

  clearAll: () => set({ unread: {}, statuses: {}, queue: [] }),

  nextUnread: (currentTerminalId) => {
    const { queue } = get();
    if (queue.length === 0) return null;
    if (!currentTerminalId) return queue[0];
    const idx = queue.indexOf(currentTerminalId);
    if (idx === -1) return queue[0];
    return queue[(idx + 1) % queue.length];
  },

  prevUnread: (currentTerminalId) => {
    const { queue } = get();
    if (queue.length === 0) return null;
    if (!currentTerminalId) return queue[queue.length - 1];
    const idx = queue.indexOf(currentTerminalId);
    if (idx === -1) return queue[queue.length - 1];
    return queue[(idx - 1 + queue.length) % queue.length];
  },
}));
