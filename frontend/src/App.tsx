import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ListTodo,
  Plus,
  RotateCcw,
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

const periods: Period[] = ["morning", "afternoon"];

const statusOptions: Array<{ id: AvailabilityStatus; label: string; shortLabel: string }> = [
  { id: "red", label: "Nein", shortLabel: "N" },
  { id: "yellow", label: "Vielleicht", shortLabel: "V" },
  { id: "green", label: "Ja", shortLabel: "J" },
];

const client = createClient();
const residentSorter = new Intl.Collator("de-CH", { sensitivity: "base" });
type DayStatus = AvailabilityStatus | "mixed" | "empty";
const taskStatusLabels: Record<Task["status"], string> = {
  planned: "geplant",
  active: "aktiv",
  done: "erledigt",
};

function availabilityId(entry: Pick<AvailabilityEntry, "date" | "period" | "residentId">): string {
  return `${entry.date}:${entry.period}:${entry.residentId}`;
}

function entryMap(entries: AvailabilityEntry[]): Map<string, AvailabilityEntry> {
  return new Map(entries.map((entry) => [entry.id ?? availabilityId(entry), entry]));
}

function periodStatusFor(
  map: Map<string, AvailabilityEntry>,
  date: string,
  period: Period,
  residentId: string,
): AvailabilityStatus | "empty" {
  return map.get(availabilityId({ date, period, residentId }))?.status ?? "empty";
}

function dayAvailabilityFor(
  map: Map<string, AvailabilityEntry>,
  date: string,
  residentId: string,
): { status: DayStatus; split: boolean } {
  const morning = periodStatusFor(map, date, "morning", residentId);
  const afternoon = periodStatusFor(map, date, "afternoon", residentId);

  if (morning === "empty" && afternoon === "empty") {
    return { status: "empty", split: false };
  }
  if (morning === afternoon) {
    return { status: morning, split: false };
  }
  if (morning === "empty") {
    return { status: afternoon, split: true };
  }
  if (afternoon === "empty") {
    return { status: morning, split: true };
  }
  return { status: "mixed", split: true };
}

function dayCounts(
  map: Map<string, AvailabilityEntry>,
  date: string,
  residents: Resident[],
): Record<AvailabilityStatus, number> & { split: number } {
  return residents.reduce(
    (counts, resident) => {
      const day = dayAvailabilityFor(map, date, resident.id);
      if (day.split) {
        counts.split += 1;
        return counts;
      }
      if (day.status !== "empty" && day.status !== "mixed") {
        counts[day.status] += 1;
      }
      return counts;
    },
    { green: 0, yellow: 0, red: 0, split: 0 },
  );
}

function dateShift(view: CalendarView, direction: number): number {
  return view === "month" ? direction * 31 : direction * 7;
}

function sortResidents(residents: Resident[]): Resident[] {
  return [...residents].sort((a, b) => residentSorter.compare(a.name, b.name));
}

export function App() {
  const [tab, setTab] = useState<AppTab>("calendar");
  const [view, setView] = useState<CalendarView>("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [residents, setResidents] = useState<Resident[]>([]);
  const [activeResident, setActiveResident] = useState("nic");
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
        const sortedResidents = sortResidents(nextResidents);
        setResidents(sortedResidents);
        setAvailability(nextAvailability);
        setTasks(nextTasks);
        setHours(nextHours);
        if (sortedResidents.length > 0 && !sortedResidents.some((resident) => resident.id === activeResident)) {
          setActiveResident(sortedResidents[0].id);
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Planungsdaten konnten nicht geladen werden.");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [activeResident, range.from, range.to]);

  async function setAvailabilityForDay(date: string, status: AvailabilityStatus) {
    const savedEntries = await Promise.all(
      periods.map((period) =>
        client.putAvailability({
          residentId: activeResident,
          date,
          period,
          status,
        }),
      ),
    );
    const savedIds = new Set(savedEntries.map((entry) => entry.id ?? availabilityId(entry)));

    setAvailability((current) => [
      ...current.filter((entry) => !savedIds.has(entry.id ?? availabilityId(entry))),
      ...savedEntries,
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
    .map((date) => {
      const key = toDateKey(date);
      const counts = dayCounts(availabilityById, key, residents);
      const people = residents
        .filter((resident) => {
          const day = dayAvailabilityFor(availabilityById, key, resident.id);
          return day.status === "green" && !day.split;
        })
        .map((resident) => resident.name)
        .join(", ");

      return {
        date,
        green: counts.green,
        yellow: counts.yellow,
        split: counts.split,
        people,
      };
    })
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
          <h1>Bauplan</h1>
        </div>
        <nav className="tabs" aria-label="Hauptbereiche">
          <button className={tab === "calendar" ? "active" : ""} onClick={() => setTab("calendar")}>
            <CalendarDays size={18} />
            Kalender
          </button>
          <button className={tab === "tasks" ? "active" : ""} onClick={() => setTab("tasks")}>
            <ListTodo size={18} />
            Aufgaben
          </button>
          <button className={tab === "hours" ? "active" : ""} onClick={() => setTab("hours")}>
            <Clock3 size={18} />
            Stunden
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
              <label htmlFor="resident">Person</label>
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

            <div className="work-window-list">
              <div className="panel-title">
                <CheckCircle2 size={17} />
                Gute Tage
              </div>
              {workWindows.length === 0 ? (
                <p className="muted">Noch keine klare Überschneidung in diesem Zeitraum.</p>
              ) : (
                workWindows.map((window) => (
                  <div key={toDateKey(window.date)} className="window-row">
                    <strong>{formatDayLabel(window.date)}</strong>
                    <span>
                      {window.green} ja
                      {window.yellow > 0 ? `, ${window.yellow} vielleicht` : ""}
                      {window.split > 0 ? `, ${window.split} geteilt` : ""}
                    </span>
                    <small>{window.people}</small>
                  </div>
                ))
              )}
            </div>
          </aside>

          <section className="planner">
            <div className="calendar-toolbar">
              <div className="month-controls">
                <button className="icon-button" onClick={() => moveCursor(-1)} aria-label="Zurück">
                  <ChevronLeft size={18} />
                </button>
                <h2>{formatMonthLabel(cursor)}</h2>
                <button className="icon-button" onClick={() => moveCursor(1)} aria-label="Weiter">
                  <ChevronRight size={18} />
                </button>
                <button className="icon-button" onClick={() => setCursor(new Date())} aria-label="Heute">
                  <RotateCcw size={17} />
                </button>
              </div>

              <div className="segmented" aria-label="Kalenderansicht">
                <button className={view === "month" ? "active" : ""} onClick={() => setView("month")}>
                  Monat
                </button>
                <button className={view === "week" ? "active" : ""} onClick={() => setView("week")}>
                  Woche
                </button>
              </div>
            </div>

            <div className={`calendar-grid ${view}`}>
              {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((day) => (
                <div className="weekday" key={day}>
                  {day}
                </div>
              ))}
              {visibleDates.map((date) => {
                const dateKey = toDateKey(date);
                const counts = dayCounts(availabilityById, dateKey, residents);
                const activeDay = dayAvailabilityFor(availabilityById, dateKey, activeResident);
                return (
                  <article
                    key={dateKey}
                    className={`day-card ${isSameMonth(date, cursor) ? "" : "outside"}`}
                  >
                    <header>
                      <span>{date.getDate()}</span>
                      {counts.split > 0 && <em>geteilt</em>}
                    </header>

                    <div
                      className={`day-cell ${activeDay.status} ${activeDay.split ? "split" : ""}`}
                    >
                      <span className="availability-score">
                        <strong>{counts.green}</strong>
                        <small>ja</small>
                      </span>
                      <span className="day-secondary">
                        {counts.yellow > 0
                          ? `${counts.yellow} vielleicht`
                          : counts.split > 0
                            ? `${counts.split} geteilt`
                            : counts.red > 0
                              ? `${counts.red} nein`
                              : ""}
                      </span>
                      <div className="day-zones" aria-label={`${dateKey} für ${activeResident} setzen`}>
                        {statusOptions.map((option) => (
                          <button
                            key={option.id}
                            className={`day-zone ${option.id} ${activeDay.status === option.id && !activeDay.split ? "selected" : ""}`}
                            onClick={() => setAvailabilityForDay(dateKey, option.id)}
                            title={`${option.label} setzen`}
                            aria-label={`${option.label} setzen`}
                          >
                            {option.shortLabel}
                          </button>
                        ))}
                      </div>
                      <div className="dots" aria-label="Status der Personen">
                        {residents.map((resident) => {
                          const day = dayAvailabilityFor(availabilityById, dateKey, resident.id);
                          const statusLabel =
                            statusOptions.find((option) => option.id === day.status)?.label ?? "offen";
                          return (
                            <span
                              key={resident.id}
                              title={`${resident.name}: ${day.split ? "geteilt" : statusLabel}`}
                              className={`dot ${day.status} ${day.split ? "split" : ""}`}
                              style={{ "--resident-color": resident.color } as React.CSSProperties}
                            />
                          );
                        })}
                      </div>
                    </div>
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
            <h2>Neue Aufgabe</h2>
            <label>
              Titel
              <input name="title" placeholder="Steinmauer, Dachbalken, Drainage..." />
            </label>
            <label>
              Schätzung
              <input name="estimateHours" type="number" min="0" step="0.5" placeholder="4" />
            </label>
            <label>
              Geplanter Tag
              <input name="plannedDate" type="date" />
            </label>
            <label>
              Notizen
              <textarea name="notes" rows={4} />
            </label>
            <button className="primary-action">
              <Plus size={18} />
              Aufgabe hinzufügen
            </button>
          </form>

          <div className="table-panel">
            <h2>Aufgaben</h2>
            <div className="task-list">
              {tasks.map((task) => (
                <article key={task.id} className="task-card">
                  <div>
                    <strong>{task.title}</strong>
                    <span>{task.estimateHours || 0}h geschätzt</span>
                  </div>
                  <span className={`pill ${task.status}`}>{taskStatusLabels[task.status]}</span>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {tab === "hours" && (
        <section className="data-layout">
          <form className="entry-panel" onSubmit={createHour}>
            <h2>Stunden eintragen</h2>
            <label>
              Person
              <select name="residentId" defaultValue={activeResident}>
                {residents.map((resident) => (
                  <option key={resident.id} value={resident.id}>
                    {resident.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Aufgabe
              <select name="taskId">
                <option value="">Allgemeine Arbeit</option>
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Datum
              <input name="date" type="date" defaultValue={toDateKey(new Date())} />
            </label>
            <label>
              Stunden
              <input name="hours" type="number" min="0" step="0.25" placeholder="3.5" />
            </label>
            <label>
              Notizen
              <textarea name="notes" rows={4} />
            </label>
            <button className="primary-action">
              <Plus size={18} />
              Stunden hinzufügen
            </button>
          </form>

          <div className="table-panel">
            <h2>Summen</h2>
            <div className="totals-grid">
              {totalsByResident.map(({ resident, hours }) => (
                <div className="total-card" key={resident.id}>
                  <span className="avatar" style={{ backgroundColor: resident.color }} />
                  <strong>{resident.name}</strong>
                  <span>{hours.toFixed(1)}h</span>
                </div>
              ))}
            </div>

            <h2>Letzte Einträge</h2>
            <div className="task-list">
              {hours.map((entry) => (
                <article className="task-card" key={entry.id}>
                  <div>
                    <strong>
                      {residents.find((resident) => resident.id === entry.residentId)?.name ?? "Person"}
                    </strong>
                    <span>{entry.date} · {entry.notes || "Allgemeine Arbeit"}</span>
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
