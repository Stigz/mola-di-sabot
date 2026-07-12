import type {
  AppClient,
  AppState,
  AvailabilityEntry,
  HourEntry,
  Resident,
  Task,
} from "../types";

const apiBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "");
const storageKey = "mola-di-sabot-state-v2";
const backupPrefix = "mola-di-sabot-state-backup-";
const sampleTaskId = "sample-roof-check";
const sampleTaskTitle = "Dach und Wasser prüfen";

const defaultResidents: Resident[] = [
  { id: "doma", name: "Domä", color: "#9333ea" },
  { id: "giulio", name: "Giulio", color: "#ea580c" },
  { id: "lars", name: "Lars", color: "#16a34a" },
  { id: "lisa", name: "Lisa", color: "#dc2626" },
  { id: "nic", name: "Nic", color: "#2563eb" },
  { id: "nico", name: "Nico", color: "#0891b2" },
];

const initialState: AppState = {
  residents: defaultResidents,
  availability: [],
  tasks: [
    {
      id: sampleTaskId,
      title: sampleTaskTitle,
      status: "planned",
      estimateHours: 4,
      plannedDate: "",
      notes: "Ersetze das mit der ersten echten Aufgabe.",
    },
  ],
  hours: [],
};

export function syncAvailable(): boolean {
  return Boolean(apiBase);
}

export function readLocalState(): AppState {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return initialState;
  try {
    return { ...initialState, ...JSON.parse(raw) };
  } catch {
    return initialState;
  }
}

function rawLocalState(): string | null {
  return localStorage.getItem(storageKey);
}

export function hasUserLocalData(state = readLocalState()): boolean {
  const hasRealTasks = state.tasks.some((task) => task.id !== sampleTaskId || task.title !== sampleTaskTitle);
  return state.availability.length > 0 || state.hours.length > 0 || hasRealTasks;
}

export function writeLocalState(state: AppState, options: { backup?: boolean } = {}): void {
  if (options.backup) {
    const raw = rawLocalState();
    if (raw) {
      localStorage.setItem(`${backupPrefix}${new Date().toISOString()}`, raw);
    }
  }
  localStorage.setItem(storageKey, JSON.stringify(state));
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!apiBase) {
    throw new Error("Cloud-Speicher ist noch nicht verbunden.");
  }

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

export async function saveLocalStateToCloud(): Promise<AppState> {
  const state = { ...readLocalState(), savedAt: new Date().toISOString() };
  const saved = await request<AppState>("/sync", {
    method: "PUT",
    body: JSON.stringify(state),
  });
  writeLocalState(saved);
  return saved;
}

export async function loadCloudStateIntoLocal(): Promise<AppState | null> {
  const state = await request<AppState | null>("/sync");
  if (!state) return null;
  writeLocalState(state, { backup: true });
  return state;
}

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function between(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

class LocalClient implements AppClient {
  async listResidents(): Promise<Resident[]> {
    return readLocalState().residents;
  }

  async listAvailability(from: string, to: string): Promise<AvailabilityEntry[]> {
    return readLocalState().availability.filter((entry) => between(entry.date, from, to));
  }

  async putAvailability(entry: AvailabilityEntry): Promise<AvailabilityEntry> {
    const state = readLocalState();
    const id = `${entry.date}:${entry.period}:${entry.residentId}`;
    const saved = { ...entry, id, updatedAt: new Date().toISOString() };
    state.availability = state.availability.filter((item) => item.id !== id);
    state.availability.push(saved);
    writeLocalState(state);
    return saved;
  }

  async listTasks(): Promise<Task[]> {
    return readLocalState().tasks;
  }

  async saveTask(task: Partial<Task> & { title: string }): Promise<Task> {
    const state = readLocalState();
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
    writeLocalState(state);
    return saved;
  }

  async listHours(from: string, to: string): Promise<HourEntry[]> {
    return readLocalState().hours.filter((entry) => between(entry.date, from, to));
  }

  async saveHour(entry: Omit<HourEntry, "id" | "createdAt">): Promise<HourEntry> {
    const state = readLocalState();
    const saved: HourEntry = {
      ...entry,
      id: uid("hour"),
      createdAt: new Date().toISOString(),
    };
    state.hours.unshift(saved);
    writeLocalState(state);
    return saved;
  }
}

export function createClient(): AppClient {
  return new LocalClient();
}
