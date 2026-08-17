import type {
  AppClient,
  AppState,
  AvailabilityEntry,
  BuildPhase,
  HourEntry,
  Resident,
  Task,
} from "../types";

const apiBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "");
const storageKey = "mola-di-sabot-state-v2";
const backupPrefix = "mola-di-sabot-state-backup-";
const sampleTaskId = "sample-roof-check";
const sampleTaskTitle = "Dach und Wasser prüfen";
const samplePhaseId = "sample-first-phase";
const samplePhaseTitle = "Erste Bauphase";
const legacyPhaseId = "legacy-phase";

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
  phases: [
    {
      id: samplePhaseId,
      title: samplePhaseTitle,
      status: "planned",
      startDate: "",
      endDate: "",
      notes: "Ersetze das mit eurer ersten echten Bauphase.",
    },
  ],
  tasks: [
    {
      id: sampleTaskId,
      phaseId: samplePhaseId,
      title: sampleTaskTitle,
      status: "planned",
      estimateHours: 4,
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
  if (!raw) return structuredClone(initialState);
  try {
    return migrateState(JSON.parse(raw) as Partial<AppState>);
  } catch {
    return structuredClone(initialState);
  }
}

function migrateState(stored: Partial<AppState>): AppState {
  const legacyTasks = (stored.tasks ?? []) as Array<Task & { plannedDate?: string }>;
  const phases = [...(stored.phases ?? [])];
  const needsLegacyPhase = legacyTasks.some((task) => !task.phaseId);

  if (needsLegacyPhase && !phases.some((phase) => phase.id === legacyPhaseId)) {
    const dates = legacyTasks.map((task) => task.plannedDate).filter((date): date is string => Boolean(date)).sort();
    phases.unshift({
      id: legacyPhaseId,
      title: "Bisherige Aufgaben",
      status: "active",
      startDate: dates[0] ?? "",
      endDate: dates[dates.length - 1] ?? dates[0] ?? "",
      notes: "Automatisch aus den bisherigen Aufgaben übernommen.",
    });
  }

  const tasks: Task[] = legacyTasks.map(({ plannedDate: _plannedDate, ...task }) => ({
    ...task,
    phaseId: task.phaseId || legacyPhaseId,
  }));
  const phaseByTask = new Map(tasks.map((task) => [task.id, task.phaseId]));
  const hours = (stored.hours ?? []).map((entry) => ({
    ...entry,
    phaseId: entry.phaseId || (entry.taskId ? phaseByTask.get(entry.taskId) : undefined),
  }));

  return {
    residents: stored.residents?.length ? stored.residents : defaultResidents,
    availability: stored.availability ?? [],
    phases,
    tasks,
    hours,
    savedAt: stored.savedAt,
  };
}

function rawLocalState(): string | null {
  return localStorage.getItem(storageKey);
}

export function hasUserLocalData(state = readLocalState()): boolean {
  const hasRealTasks = state.tasks.some((task) => task.id !== sampleTaskId || task.title !== sampleTaskTitle);
  const hasRealPhases = state.phases.some(
    (phase) => phase.id !== samplePhaseId || phase.title !== samplePhaseTitle,
  );
  return state.availability.length > 0 || state.hours.length > 0 || hasRealTasks || hasRealPhases;
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
  const migrated = migrateState(state);
  writeLocalState(migrated, { backup: true });
  return migrated;
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

  async listPhases(): Promise<BuildPhase[]> {
    return readLocalState().phases;
  }

  async savePhase(phase: Partial<BuildPhase> & { title: string }): Promise<BuildPhase> {
    const state = readLocalState();
    const now = new Date().toISOString();
    const saved: BuildPhase = {
      id: phase.id ?? uid("phase"),
      title: phase.title,
      status: phase.status ?? "planned",
      startDate: phase.startDate ?? "",
      endDate: phase.endDate ?? "",
      notes: phase.notes ?? "",
      createdAt: phase.createdAt ?? now,
      updatedAt: now,
    };
    state.phases = state.phases.filter((item) => item.id !== saved.id);
    state.phases.unshift(saved);
    writeLocalState(state);
    return saved;
  }

  async deletePhase(id: string): Promise<void> {
    const state = readLocalState();
    state.phases = state.phases.filter((phase) => phase.id !== id);
    state.tasks = state.tasks.filter((task) => task.phaseId !== id);
    writeLocalState(state);
  }

  async saveTask(task: Partial<Task> & { phaseId: string; title: string }): Promise<Task> {
    const state = readLocalState();
    const now = new Date().toISOString();
    const saved: Task = {
      id: task.id ?? uid("task"),
      phaseId: task.phaseId,
      title: task.title,
      status: task.status ?? "planned",
      estimateHours: Number(task.estimateHours ?? 0),
      notes: task.notes ?? "",
      createdAt: task.createdAt ?? now,
      updatedAt: now,
    };
    state.tasks = state.tasks.filter((item) => item.id !== saved.id);
    state.tasks.unshift(saved);
    writeLocalState(state);
    return saved;
  }

  async deleteTask(id: string): Promise<void> {
    const state = readLocalState();
    state.tasks = state.tasks.filter((task) => task.id !== id);
    writeLocalState(state);
  }

  async listHours(): Promise<HourEntry[]> {
    return readLocalState().hours;
  }

  async saveHour(
    entry: Partial<HourEntry> & Pick<HourEntry, "residentId" | "date" | "hours">,
  ): Promise<HourEntry> {
    const state = readLocalState();
    const now = new Date().toISOString();
    const saved: HourEntry = {
      ...entry,
      id: entry.id ?? uid("hour"),
      createdAt: entry.createdAt ?? now,
      updatedAt: now,
    };
    state.hours = state.hours.filter((item) => item.id !== saved.id);
    state.hours.unshift(saved);
    writeLocalState(state);
    return saved;
  }

  async deleteHour(id: string): Promise<void> {
    const state = readLocalState();
    state.hours = state.hours.filter((entry) => entry.id !== id);
    writeLocalState(state);
  }
}

export function createClient(): AppClient {
  return new LocalClient();
}
