export type AvailabilityStatus = "green" | "yellow" | "red";
export type Period = "morning" | "afternoon";
export type CalendarView = "month" | "week";
export type AppTab = "calendar" | "tasks" | "hours";

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

export interface Task {
  id: string;
  title: string;
  status: "planned" | "active" | "done";
  estimateHours: number;
  plannedDate?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface HourEntry {
  id: string;
  residentId: string;
  taskId?: string;
  date: string;
  hours: number;
  notes?: string;
  createdAt?: string;
}

export interface AppClient {
  listResidents(): Promise<Resident[]>;
  listAvailability(from: string, to: string): Promise<AvailabilityEntry[]>;
  putAvailability(entry: AvailabilityEntry): Promise<AvailabilityEntry>;
  listTasks(): Promise<Task[]>;
  saveTask(task: Partial<Task> & { title: string }): Promise<Task>;
  listHours(from: string, to: string): Promise<HourEntry[]>;
  saveHour(entry: Omit<HourEntry, "id" | "createdAt">): Promise<HourEntry>;
}

