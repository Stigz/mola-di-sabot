import {
  Banknote,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileSpreadsheet,
  Layers3,
  ListTodo,
  Plus,
  ReceiptText,
  RotateCcw,
  Settings2,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  createClient,
  hasUserLocalData,
  loadCloudStateIntoLocal,
  saveLocalStateToCloud,
  syncAvailable,
} from "./lib/api";
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
const cloudSyncAvailable = syncAvailable();
const residentSorter = new Intl.Collator("de-CH", { sensitivity: "base" });
const financeSpreadsheetUrl =
  "https://docs.google.com/spreadsheets/d/1AsAhdj9Hn7DA30unYn4Haki6sG8jufdgJFdMTpxDFR8/edit";
const financeRulesStorageKey = "mola-di-sabot-finance-rules-v1";

type DayStatus = AvailabilityStatus | "mixed" | "empty";

type FinanceRuleState = {
  amortizationMonths: number;
  hoursPerDay: number;
  hourlyRate: number;
  sharesRule: string;
};

type MaterialEntry = {
  item: string;
  amount: number;
  note: string;
  status: "offen" | "provisorisch";
};

type WorkEntry = {
  task: string;
  days: number;
};

const taskStatusLabels: Record<Task["status"], string> = {
  planned: "geplant",
  active: "aktiv",
  done: "erledigt",
};

const defaultFinanceRules: FinanceRuleState = {
  amortizationMonths: 60,
  hoursPerDay: 8,
  hourlyRate: 25,
  sharesRule: "Geld und Arbeit zählen als provisorische Anteile bis Vereinsbeschluss.",
};

const financeMaterialEntries: MaterialEntry[] = [
  {
    item: "Küche",
    amount: 2100,
    note: "Bar gekauft; gehört laut Sheet dem Verein.",
    status: "provisorisch",
  },
  {
    item: "Poschi",
    amount: 1000,
    note: "Eigentum ist im Sheet noch als Nic? markiert.",
    status: "offen",
  },
  {
    item: "Bauhaus Einkauf",
    amount: 26,
    note: "Kleininvestition; Position kann später präzisiert werden.",
    status: "provisorisch",
  },
];

const financeWorkEntries: WorkEntry[] = [
  { task: "Hühnerhüsli ufrume", days: 5 },
  { task: "Keller bau, Küche", days: 9.5 },
  { task: "Abwasser", days: 6.5 },
  { task: "Küche / Abwasser", days: 7 },
  { task: "Küche zügeln + Zementierung; Bodenversiegelung", days: 7 },
  { task: "Küche einbauen", days: 3.5 },
  { task: "Strom Küche", days: 2 },
  { task: "Wochen ohne Aufgabe", days: 9 },
];

const currencyFormatter = new Intl.NumberFormat("de-CH", {
  currency: "CHF",
  style: "currency",
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat("de-CH", {
  maximumFractionDigits: 1,
});

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

function appBasePath(): string {
  const base = import.meta.env.BASE_URL || "/";
  return base.endsWith("/") ? base : `${base}/`;
}

function pathForTab(nextTab: AppTab): string {
  const base = appBasePath();
  if (nextTab === "finance") {
    return `${base.replace(/\/$/, "")}/finanzen`;
  }
  return base;
}

function tabFromPath(pathname = window.location.pathname): AppTab {
  return pathname.replace(/\/$/, "").endsWith("/finanzen") ? "finance" : "calendar";
}

function formatCHF(value: number): string {
  if (Number.isInteger(value)) {
    return currencyFormatter.format(value).replace(".00", "");
  }
  return currencyFormatter.format(value);
}

function parsePositiveNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readFinanceRules(): FinanceRuleState {
  const raw = localStorage.getItem(financeRulesStorageKey);
  if (!raw) return defaultFinanceRules;
  try {
    return { ...defaultFinanceRules, ...JSON.parse(raw) };
  } catch {
    return defaultFinanceRules;
  }
}

function writeFinanceRules(rules: FinanceRuleState): void {
  localStorage.setItem(financeRulesStorageKey, JSON.stringify(rules));
}

export function App() {
  const [tab, setTabState] = useState<AppTab>(() => tabFromPath());
  const [view, setView] = useState<CalendarView>("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [residents, setResidents] = useState<Resident[]>([]);
  const [activeResident, setActiveResident] = useState("nic");
  const [availability, setAvailability] = useState<AvailabilityEntry[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [hours, setHours] = useState<HourEntry[]>([]);
  const [message, setMessage] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const visibleDates = useMemo(
    () => (view === "month" ? monthGrid(cursor) : weekGrid(cursor)),
    [cursor, view],
  );
  const range = useMemo(() => rangeKeys(visibleDates), [visibleDates]);
  const availabilityById = useMemo(() => entryMap(availability), [availability]);

  useEffect(() => {
    const handlePopState = () => setTabState(tabFromPath());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

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
  }, [activeResident, range.from, range.to, reloadNonce]);

  useEffect(() => {
    let cancelled = false;

    async function loadCloudIfLocalIsEmpty() {
      if (!cloudSyncAvailable || hasUserLocalData()) return;
      try {
        const cloudState = await loadCloudStateIntoLocal();
        if (!cancelled && cloudState && hasUserLocalData(cloudState)) {
          setSyncMessage("Cloud-Daten geladen.");
          setReloadNonce((value) => value + 1);
        }
      } catch {
        if (!cancelled) {
          setSyncMessage("Cloud konnte nicht automatisch geladen werden.");
        }
      }
    }

    loadCloudIfLocalIsEmpty();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveToCloud() {
    setSyncBusy(true);
    setSyncMessage("");
    try {
      await saveLocalStateToCloud();
      setSyncMessage("Cloud gespeichert.");
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "Cloud konnte nicht gespeichert werden.");
    } finally {
      setSyncBusy(false);
    }
  }

  async function loadFromCloud() {
    setSyncBusy(true);
    setSyncMessage("");
    try {
      const cloudState = await loadCloudStateIntoLocal();
      if (!cloudState) {
        setSyncMessage("Noch keine Cloud-Daten vorhanden.");
        return;
      }
      setSyncMessage("Cloud geladen. Vorheriger Browser-Stand wurde gesichert.");
      setReloadNonce((value) => value + 1);
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "Cloud konnte nicht geladen werden.");
    } finally {
      setSyncBusy(false);
    }
  }

  function switchTab(nextTab: AppTab) {
    setTabState(nextTab);
    const nextPath = pathForTab(nextTab);
    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, "", nextPath);
    }
  }

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
          <button className={tab === "calendar" ? "active" : ""} onClick={() => switchTab("calendar")}>
            <CalendarDays size={18} />
            Kalender
          </button>
          <button className={tab === "tasks" ? "active" : ""} onClick={() => switchTab("tasks")}>
            <ListTodo size={18} />
            Aufgaben
          </button>
          <button className={tab === "hours" ? "active" : ""} onClick={() => switchTab("hours")}>
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

            <div className="sync-panel">
              <button className="sync-action primary" onClick={saveToCloud} disabled={!cloudSyncAvailable || syncBusy}>
                <CheckCircle2 size={16} />
                Cloud speichern
              </button>
              <button className="sync-action" onClick={loadFromCloud} disabled={!cloudSyncAvailable || syncBusy}>
                <RotateCcw size={16} />
                Cloud laden
              </button>
              <p className="sync-note">
                {syncMessage || (cloudSyncAvailable ? "Speichern kopiert diesen Browserstand in die Cloud." : "Cloud ist noch nicht verbunden.")}
              </p>
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

      {tab === "finance" && <FinancePage />}
    </main>
  );
}

function FinancePage() {
  const [rules, setRules] = useState<FinanceRuleState>(() => readFinanceRules());

  const materialTotal = financeMaterialEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const openMaterialTotal = financeMaterialEntries
    .filter((entry) => entry.status === "offen")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const workDays = financeWorkEntries.reduce((sum, entry) => sum + entry.days, 0);
  const workHours = workDays * rules.hoursPerDay;
  const workTotal = workHours * rules.hourlyRate;
  const phaseTotal = materialTotal + workTotal;
  const monthlyAmortization = rules.amortizationMonths > 0 ? phaseTotal / rules.amortizationMonths : 0;

  function updateFinanceRule<Key extends keyof FinanceRuleState>(
    key: Key,
    value: FinanceRuleState[Key],
  ) {
    setRules((current) => {
      const next = { ...current, [key]: value };
      writeFinanceRules(next);
      return next;
    });
  }

  function resetFinanceRules() {
    writeFinanceRules(defaultFinanceRules);
    setRules(defaultFinanceRules);
  }

  return (
    <section className="finance-page">
      <div className="finance-hero">
        <div>
          <p className="eyebrow">Finanzen</p>
          <h2>Mühle Täbu März-Juni 2026</h2>
          <p>
            Diese Seite ist bewusst nicht in der Hauptnavigation. Die Bauphase ist der einzige Ort,
            an dem Arbeit in Geld und provisorische Anteile umgerechnet wird.
          </p>
        </div>
        <a className="sheet-link" href={financeSpreadsheetUrl} target="_blank" rel="noreferrer">
          <FileSpreadsheet size={18} />
          Google Sheet
        </a>
      </div>

      <div className="finance-stats">
        <article>
          <ReceiptText size={18} />
          <span>Material</span>
          <strong>{formatCHF(materialTotal)}</strong>
          <small>{openMaterialTotal > 0 ? `${formatCHF(openMaterialTotal)} offen` : "provisorisch"}</small>
        </article>
        <article>
          <Clock3 size={18} />
          <span>Arbeit</span>
          <strong>{formatCHF(workTotal)}</strong>
          <small>{numberFormatter.format(workHours)}h aus {numberFormatter.format(workDays)} Tagen</small>
        </article>
        <article>
          <Layers3 size={18} />
          <span>Bauphase total</span>
          <strong>{formatCHF(phaseTotal)}</strong>
          <small>provisorische Anteile</small>
        </article>
        <article>
          <Banknote size={18} />
          <span>Amortisation</span>
          <strong>{rules.amortizationMonths > 0 ? formatCHF(monthlyAmortization) : "keine"}</strong>
          <small>{rules.amortizationMonths > 0 ? "pro Monat" : "nicht verteilt"}</small>
        </article>
      </div>

      <div className="finance-grid">
        <section className="finance-panel finance-overview">
          <div className="panel-heading">
            <Layers3 size={18} />
            <h2>Bauphase</h2>
          </div>
          <dl className="finance-facts">
            <div>
              <dt>Zeitraum</dt>
              <dd>02.03.2026 bis 30.06.2026</dd>
            </div>
            <div>
              <dt>Quelle</dt>
              <dd>Tabs Bauphasen, Investitionen, Arbeit Wochen</dd>
            </div>
            <div>
              <dt>Arbeitswert</dt>
              <dd>
                {numberFormatter.format(workDays)} Tage × {numberFormatter.format(rules.hoursPerDay)}h × {formatCHF(rules.hourlyRate)} = {formatCHF(workTotal)}
              </dd>
            </div>
            <div>
              <dt>Regel</dt>
              <dd>{rules.sharesRule}</dd>
            </div>
          </dl>
          <div className="amortization-line">
            <span>Gesamtwert</span>
            <strong>{formatCHF(phaseTotal)}</strong>
            <span>{rules.amortizationMonths || 0} Monate</span>
          </div>
        </section>

        <section className="finance-panel finance-rules">
          <div className="panel-heading">
            <Settings2 size={18} />
            <h2>Regeln</h2>
          </div>
          <label>
            Amortisation Monate
            <input
              type="number"
              min="0"
              value={rules.amortizationMonths}
              onChange={(event) =>
                updateFinanceRule(
                  "amortizationMonths",
                  parsePositiveNumber(event.target.value, defaultFinanceRules.amortizationMonths),
                )
              }
            />
          </label>
          <label>
            Stunden pro Tag
            <input
              type="number"
              min="0"
              step="0.25"
              value={rules.hoursPerDay}
              onChange={(event) =>
                updateFinanceRule("hoursPerDay", parsePositiveNumber(event.target.value, defaultFinanceRules.hoursPerDay))
              }
            />
          </label>
          <label>
            CHF pro Stunde
            <input
              type="number"
              min="0"
              step="0.5"
              value={rules.hourlyRate}
              onChange={(event) =>
                updateFinanceRule("hourlyRate", parsePositiveNumber(event.target.value, defaultFinanceRules.hourlyRate))
              }
            />
          </label>
          <label>
            Anteile-Regel
            <textarea
              rows={3}
              value={rules.sharesRule}
              onChange={(event) => updateFinanceRule("sharesRule", event.target.value)}
            />
          </label>
          <button className="secondary-action" onClick={resetFinanceRules} type="button">
            <RotateCcw size={16} />
            Standardregeln
          </button>
        </section>
      </div>

      <div className="finance-detail-grid">
        <section className="finance-panel">
          <div className="panel-heading">
            <ReceiptText size={18} />
            <h2>Material</h2>
          </div>
          <div className="material-list">
            {financeMaterialEntries.map((entry) => (
              <article className="material-row" key={entry.item}>
                <div>
                  <strong>{entry.item}</strong>
                  <span>{entry.note}</span>
                </div>
                <strong>{formatCHF(entry.amount)}</strong>
                <span className={`finance-status ${entry.status}`}>{entry.status}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="finance-panel">
          <div className="panel-heading">
            <ListTodo size={18} />
            <h2>Aufgaben in der Bauphase</h2>
          </div>
          <p className="muted finance-note">
            Aufgaben erklären die Arbeit. Der CHF-Wert wird nur oben für die ganze Bauphase gerechnet.
          </p>
          <div className="task-sublist">
            {financeWorkEntries.map((entry) => (
              <article className="task-subrow" key={entry.task}>
                <span>{entry.task}</span>
                <strong>{numberFormatter.format(entry.days)} Tage</strong>
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className="finance-panel finance-guide">
        <div className="panel-heading">
          <FileSpreadsheet size={18} />
          <h2>Kurz-Anleitung</h2>
        </div>
        <ol className="guide-list">
          <li>
            <strong>Bauphase setzen:</strong>
            <span>Ein Zeitraum bündelt Material, Arbeit und offene Fragen.</span>
          </li>
          <li>
            <strong>Material prüfen:</strong>
            <span>Beleg, Betrag und Eigentum sauber festhalten.</span>
          </li>
          <li>
            <strong>Arbeit zählen:</strong>
            <span>Tage sammeln; der CHF-Wert kommt aus den Regeln.</span>
          </li>
          <li>
            <strong>Regeln anpassen:</strong>
            <span>Stunden, Stundensatz und Amortisation provisorisch setzen.</span>
          </li>
          <li>
            <strong>Beschluss machen:</strong>
            <span>Wenn alle einverstanden sind, offene Punkte aktualisieren.</span>
          </li>
        </ol>
      </section>

      <section className="finance-panel finance-reading">
        <div className="panel-heading">
          <ReceiptText size={18} />
          <h2>Lesart</h2>
        </div>
        <div className="reading-grid compact">
          <p>
            <strong>Bauphase</strong> ist das Ding, das amortisiert wird: hier die ganze Mühle-Täbu-Tabelle.
          </p>
          <p>
            <strong>Aufgaben</strong> sind nur die Unterliste der Arbeit. Sie bekommen keinen eigenen CHF-Wert.
          </p>
          <p>
            <strong>Material</strong> bleibt als einzelne Position sichtbar, weil Belege und Eigentum geklärt werden müssen.
          </p>
          <p>
            <strong>Anteile</strong> bleiben provisorisch, bis der Verein die Regeln annimmt.
          </p>
        </div>
      </section>
    </section>
  );
}
