export type AvailabilityStatus = "green" | "yellow" | "red";
export type Period = "morning" | "afternoon";
export type CalendarView = "month" | "week";
export type AppTab = "calendar" | "tasks" | "hours" | "finance";
export type WorkStatus = "planned" | "active" | "done";

export interface Resident {
  id: string;
  name: string;
  color: string;
}

export interface AvailabilityEntry {
  id?: string;
  residentId: string;
  date: string;
  period: Period;
  status: AvailabilityStatus;
  updatedAt?: string;
}

export interface BuildPhase {
  id: string;
  title: string;
  status: WorkStatus;
  startDate?: string;
  endDate?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Task {
  id: string;
  phaseId: string;
  title: string;
  status: WorkStatus;
  estimateHours: number;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface HourEntry {
  id: string;
  residentId: string;
  phaseId?: string;
  taskId?: string;
  date: string;
  hours: number;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AppState {
  residents: Resident[];
  availability: AvailabilityEntry[];
  phases: BuildPhase[];
  tasks: Task[];
  hours: HourEntry[];
  savedAt?: string;
}

export interface AppClient {
  listResidents(): Promise<Resident[]>;
  listAvailability(from: string, to: string): Promise<AvailabilityEntry[]>;
  putAvailability(entry: AvailabilityEntry): Promise<AvailabilityEntry>;
  listPhases(): Promise<BuildPhase[]>;
  savePhase(phase: Partial<BuildPhase> & { title: string }): Promise<BuildPhase>;
  deletePhase(id: string): Promise<void>;
  listTasks(): Promise<Task[]>;
  saveTask(task: Partial<Task> & { phaseId: string; title: string }): Promise<Task>;
  deleteTask(id: string): Promise<void>;
  listHours(): Promise<HourEntry[]>;
  saveHour(
    entry: Partial<HourEntry> & Pick<HourEntry, "residentId" | "date" | "hours">,
  ): Promise<HourEntry>;
  deleteHour(id: string): Promise<void>;
}
