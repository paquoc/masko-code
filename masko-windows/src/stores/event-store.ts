import { createStore } from "solid-js/store";
import type { AgentEvent } from "../models/agent-event";

const MAX_EVENTS = 200;

const [events, setEvents] = createStore<AgentEvent[]>([]);

export function appendEvent(event: AgentEvent): void {
  setEvents((prev) => {
    const next = [...prev, event];
    return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
  });
}

export const eventStore = {
  get events() { return events; },
  appendEvent,
};
