import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ListTodo,
  Plus,
  RotateCcw,
  UsersRound,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "./lib/api";
import {
  addDays,
  formatDayLabel,
  formatMonthLabel,
  isSameMonth,
  monthGrid,
  rangeKeys,
  toDateKey,
  weekGrid,
} from "./lib/date";
import type {
  AppTab,
  AvailabilityEntry,
  AvailabilityStatus,
  CalendarView,
  HourEntry,
  Period,
  Resident,
  Task,
} from "./types";

const periods: Array<{ id: Period; label: string }> = [
  { id: "morning", label: "AM" },
  { id: "afternoon", label: "PM" },
];

const statusOptions: Array<{ id: AvailabilityStatus; label: string }> = [
  { id: "green", label: "Green" },
  { id: "yellow", label: "Yellow" },
  { id: "red", label: "Red" },
];

const client = createClient();

function availabilityId(entry: Pick<AvailabilityEntry, "date" | "period" | "residentId">): string {
  return `${entry.date}:${entry.period}:${entry.residentId}`;
}

function entryMap(entries: AvailabilityEntry[]): Map<string, AvailabilityEntry> {
  return new Map(entries.map((entry) => [entry.id ?? availabilityId(entry), entry]));
}

function statusCounts(
  entries: AvailabilityEntry[],
  date: string,
  period: Period,
): Record<AvailabilityStatus, number> {
  return entries
    .filter((entry) => entry.date === date && entry.period === period)
    .reduce(
      (counts, entry) => {
        counts[entry.status] += 1;
        return counts;
      },
      { green: 0, yellow: 0, red: 0 },
    );
}

function statusFor(
  map: Map<string, AvailabilityEntry>,
  date: string,
  period: Period,
  residentId: string,
): AvailabilityStatus | "empty" {
  return map.get(availabilityId({ date, period, residentId }))?.status ?? "empty";
}

function dateShift(view: CalendarView, direction: number): number {
  return view === "month" ? direction * 31 : direction * 7;
}

export function App() {
  const [tab, setTab] = useState<AppTab>("calendar");
  const [view, setView] = useState<CalendarView>("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [residents, setResidents] = useState<Resident[]>([]);
  const [activeResident, setActiveResident] = useState("nicolas");
  const [paintStatus, setPaintStatus] = useState<AvailabilityStatus>("green");
  const [availability, setAvailability] = useState<AvailabilityEntry[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [hours, setHours] = useState<HourEntry[]>([]);
  const [message, setMessage] = useState("");

  const visibleDates = useMemo(
    () => (view === "month" ? monthGrid(cursor) : weekGrid(cursor)),
    [cursor, view],
  );
  const range = useMemo(() => rangeKeys(visibleDates), [visibleDates]);
  const availabilityById = useMemo(() => entryMap(availability), [availability]);
  const activeResidentRecord = residents.find((resident) => resident.id === activeResident);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [nextResidents, nextAvailability, nextTasks, nextHours] = await Promise.all([
          client.listResidents(),
          client.listAvailability(range.from, range.to),
          client.listTasks(),
          client.listHours(range.from, range.to),
        ]);

        if (cancelled) return;
        setResidents(nextResidents);
        setAvailability(nextAvailability);
        setTasks(nextTasks);
        setHours(nextHours);
        if (nextResidents.length > 0 && !nextResidents.some((resident) => resident.id === activeResident)) {
          setActiveResident(nextResidents[0].id);
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not load planning data.");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [activeResident, range.from, range.to]);

  async function setAvailabilityFor(date: string, period: Period) {
    const saved = await client.putAvailability({
      residentId: activeResident,
      date,
      period,
      status: paintStatus,
    });

    setAvailability((current) => [
      ...current.filter((entry) => (entry.id ?? availabilityId(entry)) !== (saved.id ?? availabilityId(saved))),
      saved,
    ]);
  }

  function moveCursor(direction: number) {
    const next = addDays(cursor, dateShift(view, direction));
    if (view === "month") {
      setCursor(new Date(next.getFullYear(), next.getMonth(), 1));
      return;
    }
    setCursor(next);
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const title = String(data.get("title") ?? "").trim();
    if (!title) return;

    const saved = await client.saveTask({
      title,
      estimateHours: Number(data.get("estimateHours") ?? 0),
      plannedDate: String(data.get("plannedDate") ?? ""),
      notes: String(data.get("notes") ?? ""),
      status: "planned",
    });
    setTasks((current) => [saved, ...current]);
    event.currentTarget.reset();
  }

  async function createHour(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const saved = await client.saveHour({
      residentId: String(data.get("residentId")),
      taskId: String(data.get("taskId") ?? ""),
      date: String(data.get("date")),
      hours: Number(data.get("hours") ?? 0),
      notes: String(data.get("notes") ?? ""),
    });
    setHours((current) => [saved, ...current]);
    event.currentTarget.reset();
  }

  const workWindows = visibleDates
    .flatMap((date) =>
      periods.map((period) => {
        const key = toDateKey(date);
        const counts = statusCounts(availability, key, period.id);
        const people = availability
          .filter((entry) => entry.date === key && entry.period === period.id && entry.status === "green")
          .map((entry) => residents.find((resident) => resident.id === entry.residentId)?.name)
          .filter(Boolean)
          .join(", ");

        return {
          date,
          period: period.label,
          green: counts.green,
          yellow: counts.yellow,
          people,
        };
      }),
    )
    .filter((window) => window.green >= 2)
    .sort((a, b) => b.green - a.green || b.yellow - a.yellow)
    .slice(0, 8);

  const totalsByResident = residents.map((resident) => ({
    resident,
    hours: hours
      .filter((entry) => entry.residentId === resident.id)
      .reduce((sum, entry) => sum + entry.hours, 0),
  }));

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Mola di Sabot</p>
          <h1>Build Planner</h1>
        </div>
        <nav className="tabs" aria-label="Main sections">
          <button className={tab === "calendar" ? "active" : ""} onClick={() => setTab("calendar")}>
            <CalendarDays size={18} />
            Calendar
          </button>
          <button className={tab === "tasks" ? "active" : ""} onClick={() => setTab("tasks")}>
            <ListTodo size={18} />
            Tasks
          </button>
          <button className={tab === "hours" ? "active" : ""} onClick={() => setTab("hours")}>
            <Clock3 size={18} />
            Hours
          </button>
        </nav>
      </header>

      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}

      {tab === "calendar" && (
        <section className="calendar-layout">
          <aside className="side-panel">
            <div className="field">
              <label htmlFor="resident">Resident</label>
              <select
                id="resident"
                value={activeResident}
                onChange={(event) => setActiveResident(event.target.value)}
              >
                {residents.map((resident) => (
                  <option key={resident.id} value={resident.id}>
                    {resident.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="status-picker" aria-label="Availability status">
              {statusOptions.map((option) => (
                <button
                  key={option.id}
                  className={`status-button ${option.id} ${paintStatus === option.id ? "active" : ""}`}
                  onClick={() => setPaintStatus(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="resident-list">
              <div className="panel-title">
                <UsersRound size={17} />
                Residents
              </div>
              {residents.map((resident) => (
                <button
                  key={resident.id}
                  className={`resident-row ${resident.id === activeResident ? "active" : ""}`}
                  onClick={() => setActiveResident(resident.id)}
                >
                  <span className="avatar" style={{ backgroundColor: resident.color }} />
                  {resident.name}
                </button>
              ))}
            </div>

            <div className="work-window-list">
              <div className="panel-title">
                <CheckCircle2 size={17} />
                Work Windows
              </div>
              {workWindows.length === 0 ? (
                <p className="muted">No strong overlap in this range yet.</p>
              ) : (
                workWindows.map((window) => (
                  <div key={`${toDateKey(window.date)}-${window.period}`} className="window-row">
                    <strong>{formatDayLabel(window.date)} {window.period}</strong>
                    <span>{window.green} green, {window.yellow} yellow</span>
                    <small>{window.people}</small>
                  </div>
                ))
              )}
            </div>
          </aside>

          <section className="planner">
            <div className="calendar-toolbar">
              <div className="month-controls">
                <button className="icon-button" onClick={() => moveCursor(-1)} aria-label="Previous">
                  <ChevronLeft size={18} />
                </button>
                <h2>{formatMonthLabel(cursor)}</h2>
                <button className="icon-button" onClick={() => moveCursor(1)} aria-label="Next">
                  <ChevronRight size={18} />
                </button>
                <button className="icon-button" onClick={() => setCursor(new Date())} aria-label="Today">
                  <RotateCcw size={17} />
                </button>
              </div>

              <div className="segmented" aria-label="Calendar view">
                <button className={view === "month" ? "active" : ""} onClick={() => setView("month")}>
                  Month
                </button>
                <button className={view === "week" ? "active" : ""} onClick={() => setView("week")}>
                  Week
                </button>
              </div>
            </div>

            <div className={`calendar-grid ${view}`}>
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                <div className="weekday" key={day}>
                  {day}
                </div>
              ))}
              {visibleDates.map((date) => {
                const dateKey = toDateKey(date);
                return (
                  <article
                    key={dateKey}
                    className={`day-card ${isSameMonth(date, cursor) ? "" : "outside"}`}
                  >
                    <header>
                      <span>{formatDayLabel(date)}</span>
                      {activeResidentRecord && (
                        <span className="active-person">
                          <span
                            className="avatar small"
                            style={{ backgroundColor: activeResidentRecord.color }}
                          />
                          {activeResidentRecord.name}
                        </span>
                      )}
                    </header>

                    {periods.map((period) => {
                      const counts = statusCounts(availability, dateKey, period.id);
                      const activeStatus = statusFor(availabilityById, dateKey, period.id, activeResident);

                      return (
                        <button
                          key={period.id}
                          className={`period-cell ${activeStatus}`}
                          onClick={() => setAvailabilityFor(dateKey, period.id)}
                        >
                          <span>{period.label}</span>
                          <strong>{counts.green}</strong>
                          <small>{counts.yellow} maybe</small>
                          <div className="dots" aria-label="Resident statuses">
                            {residents.map((resident) => (
                              <span
                                key={resident.id}
                                title={`${resident.name}: ${statusFor(
                                  availabilityById,
                                  dateKey,
                                  period.id,
                                  resident.id,
                                )}`}
                                className={`dot ${statusFor(
                                  availabilityById,
                                  dateKey,
                                  period.id,
                                  resident.id,
                                )}`}
                                style={{ "--resident-color": resident.color } as React.CSSProperties}
                              />
                            ))}
                          </div>
                        </button>
                      );
                    })}
                  </article>
                );
              })}
            </div>
          </section>
        </section>
      )}

      {tab === "tasks" && (
        <section className="data-layout">
          <form className="entry-panel" onSubmit={createTask}>
            <h2>New Task</h2>
            <label>
              Title
              <input name="title" placeholder="Stone wall, roof beam, drainage..." />
            </label>
            <label>
              Estimate
              <input name="estimateHours" type="number" min="0" step="0.5" placeholder="4" />
            </label>
            <label>
              Planned date
              <input name="plannedDate" type="date" />
            </label>
            <label>
              Notes
              <textarea name="notes" rows={4} />
            </label>
            <button className="primary-action">
              <Plus size={18} />
              Add Task
            </button>
          </form>

          <div className="table-panel">
            <h2>Tasks</h2>
            <div className="task-list">
              {tasks.map((task) => (
                <article key={task.id} className="task-card">
                  <div>
                    <strong>{task.title}</strong>
                    <span>{task.estimateHours || 0}h estimate</span>
                  </div>
                  <span className={`pill ${task.status}`}>{task.status}</span>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {tab === "hours" && (
        <section className="data-layout">
          <form className="entry-panel" onSubmit={createHour}>
            <h2>Log Hours</h2>
            <label>
              Resident
              <select name="residentId" defaultValue={activeResident}>
                {residents.map((resident) => (
                  <option key={resident.id} value={resident.id}>
                    {resident.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Task
              <select name="taskId">
                <option value="">General work</option>
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date
              <input name="date" type="date" defaultValue={toDateKey(new Date())} />
            </label>
            <label>
              Hours
              <input name="hours" type="number" min="0" step="0.25" placeholder="3.5" />
            </label>
            <label>
              Notes
              <textarea name="notes" rows={4} />
            </label>
            <button className="primary-action">
              <Plus size={18} />
              Add Hours
            </button>
          </form>

          <div className="table-panel">
            <h2>Totals</h2>
            <div className="totals-grid">
              {totalsByResident.map(({ resident, hours }) => (
                <div className="total-card" key={resident.id}>
                  <span className="avatar" style={{ backgroundColor: resident.color }} />
                  <strong>{resident.name}</strong>
                  <span>{hours.toFixed(1)}h</span>
                </div>
              ))}
            </div>

            <h2>Recent Entries</h2>
            <div className="task-list">
              {hours.map((entry) => (
                <article className="task-card" key={entry.id}>
                  <div>
                    <strong>
                      {residents.find((resident) => resident.id === entry.residentId)?.name ?? "Resident"}
                    </strong>
                    <span>{entry.date} · {entry.notes || "General work"}</span>
                  </div>
                  <span className="pill active">{entry.hours}h</span>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

