import type {
  AppClient,
  AvailabilityEntry,
  HourEntry,
  Resident,
  Task,
} from "../types";

const apiBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "");
const storageKey = "mola-di-sabot-state-v2";

interface LocalState {
  residents: Resident[];
  availability: AvailabilityEntry[];
  tasks: Task[];
  hours: HourEntry[];
}

const defaultResidents: Resident[] = [
  { id: "doma", name: "Domä", color: "#9333ea" },
  { id: "giulio", name: "Giulio", color: "#ea580c" },
  { id: "lars", name: "Lars", color: "#16a34a" },
  { id: "lisa", name: "Lisa", color: "#dc2626" },
  { id: "nic", name: "Nic", color: "#2563eb" },
  { id: "nico", name: "Nico", color: "#0891b2" },
];

const initialState: LocalState = {
  residents: defaultResidents,
  availability: [],
  tasks: [
    {
      id: "sample-roof-check",
      title: "Roof and water check",
      status: "planned",
      estimateHours: 4,
      plannedDate: "",
      notes: "Ersetze das mit der ersten echten Aufgabe.",
    },
  ],
  hours: [],
};

function readLocal(): LocalState {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return initialState;
  try {
    return { ...initialState, ...JSON.parse(raw) };
  } catch {
    return initialState;
  }
}

function writeLocal(state: LocalState): void {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function between(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

class LocalClient implements AppClient {
  async listResidents(): Promise<Resident[]> {
    return readLocal().residents;
  }

  async listAvailability(from: string, to: string): Promise<AvailabilityEntry[]> {
    return readLocal().availability.filter((entry) => between(entry.date, from, to));
  }

  async putAvailability(entry: AvailabilityEntry): Promise<AvailabilityEntry> {
    const state = readLocal();
    const id = `${entry.date}:${entry.period}:${entry.residentId}`;
    const saved = { ...entry, id, updatedAt: new Date().toISOString() };
    state.availability = state.availability.filter((item) => item.id !== id);
    state.availability.push(saved);
    writeLocal(state);
    return saved;
  }

  async listTasks(): Promise<Task[]> {
    return readLocal().tasks;
  }

  async saveTask(task: Partial<Task> & { title: string }): Promise<Task> {
    const state = readLocal();
    const now = new Date().toISOString();
    const saved: Task = {
      id: task.id ?? uid("task"),
      title: task.title,
      status: task.status ?? "planned",
      estimateHours: Number(task.estimateHours ?? 0),
      plannedDate: task.plannedDate ?? "",
      notes: task.notes ?? "",
      createdAt: task.createdAt ?? now,
      updatedAt: now,
    };
    state.tasks = state.tasks.filter((item) => item.id !== saved.id);
    state.tasks.unshift(saved);
    writeLocal(state);
    return saved;
  }

  async listHours(from: string, to: string): Promise<HourEntry[]> {
    return readLocal().hours.filter((entry) => between(entry.date, from, to));
  }

  async saveHour(entry: Omit<HourEntry, "id" | "createdAt">): Promise<HourEntry> {
    const state = readLocal();
    const saved: HourEntry = {
      ...entry,
      id: uid("hour"),
      createdAt: new Date().toISOString(),
    };
    state.hours.unshift(saved);
    writeLocal(state);
    return saved;
  }
}

class ApiClient implements AppClient {
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`API-Anfrage fehlgeschlagen: ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  listResidents(): Promise<Resident[]> {
    return this.request("/residents");
  }

  listAvailability(from: string, to: string): Promise<AvailabilityEntry[]> {
    return this.request(`/availability?from=${from}&to=${to}`);
  }

  putAvailability(entry: AvailabilityEntry): Promise<AvailabilityEntry> {
    return this.request("/availability", {
      method: "PUT",
      body: JSON.stringify(entry),
    });
  }

  listTasks(): Promise<Task[]> {
    return this.request("/tasks");
  }

  saveTask(task: Partial<Task> & { title: string }): Promise<Task> {
    return this.request("/tasks", {
      method: task.id ? "PATCH" : "POST",
      body: JSON.stringify(task),
    });
  }

  listHours(from: string, to: string): Promise<HourEntry[]> {
    return this.request(`/hours?from=${from}&to=${to}`);
  }

  saveHour(entry: Omit<HourEntry, "id" | "createdAt">): Promise<HourEntry> {
    return this.request("/hours", {
      method: "POST",
      body: JSON.stringify(entry),
    });
  }
}

export function createClient(): AppClient {
  return apiBase ? new ApiClient() : new LocalClient();
}
