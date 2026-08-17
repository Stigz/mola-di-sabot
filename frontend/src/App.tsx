import {
  Banknote,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileSpreadsheet,
  Layers3,
  ListTodo,
  Pencil,
  Plus,
  ReceiptText,
  RotateCcw,
  Settings2,
  Trash2,
  X,
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
  formatMonthShort,
  formatWeekdayShort,
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
  BuildPhase,
  CalendarView,
  HourEntry,
  Period,
  Resident,
  Task,
  WorkStatus,
} from "./types";

const periods: Period[] = ["morning", "afternoon"];

const statusOptions: Array<{ id: AvailabilityStatus; label: string }> = [
  { id: "red", label: "Nein" },
  { id: "yellow", label: "Vielleicht" },
  { id: "green", label: "Ja" },
];

const residentEmoji: Record<string, string> = {
  nic: "🇺🇸",
  giulio: "🇯🇲",
  doma: "🇩🇴",
  nico: "🇮🇹",
  lars: "🚩",
  lisa: "🇨🇭",
};

function emojiForResident(resident: Resident): string {
  return residentEmoji[resident.id] ?? "●";
}

const client = createClient();
const cloudSyncAvailable = syncAvailable();
const residentSorter = new Intl.Collator("de-CH", { sensitivity: "base" });
const financeSpreadsheetUrl =
  "https://docs.google.com/spreadsheets/d/1AsAhdj9Hn7DA30unYn4Haki6sG8jufdgJFdMTpxDFR8/edit";
const financeRulesStorageKey = "mola-di-sabot-finance-rules-v1";
const calendarHelpStorageKey = "mola-di-sabot-calendar-help-seen-v1";

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

const taskStatusLabels: Record<WorkStatus, string> = {
  planned: "geplant",
  active: "aktiv",
  done: "erledigt",
};

type PhaseDraft = {
  title: string;
  status: WorkStatus;
  startDate: string;
  endDate: string;
  notes: string;
};

type TaskDraft = {
  id?: string;
  phaseId: string;
  title: string;
  status: WorkStatus;
  estimateHours: string;
  notes: string;
  createdAt?: string;
};

type HourDraft = {
  id?: string;
  residentId: string;
  phaseId: string;
  taskId: string;
  date: string;
  hours: string;
  notes: string;
  createdAt?: string;
};

const emptyPhaseDraft: PhaseDraft = {
  title: "",
  status: "planned",
  startDate: "",
  endDate: "",
  notes: "",
};

function emptyHourDraft(residentId = "nic"): HourDraft {
  return {
    residentId,
    phaseId: "",
    taskId: "",
    date: toDateKey(new Date()),
    hours: "",
    notes: "",
  };
}

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
  const [phases, setPhases] = useState<BuildPhase[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [hours, setHours] = useState<HourEntry[]>([]);
  const [phaseDraft, setPhaseDraft] = useState<PhaseDraft>(emptyPhaseDraft);
  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null);
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);
  const [hourDraft, setHourDraft] = useState<HourDraft>(() => emptyHourDraft());
  const [message, setMessage] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [calendarHelpOpen, setCalendarHelpOpen] = useState(
    () => localStorage.getItem(calendarHelpStorageKey) !== "true",
  );

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
    if (!calendarHelpOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeCalendarHelp();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [calendarHelpOpen]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [nextResidents, nextAvailability, nextPhases, nextTasks, nextHours] = await Promise.all([
          client.listResidents(),
          client.listAvailability(range.from, range.to),
          client.listPhases(),
          client.listTasks(),
          client.listHours(),
        ]);

        if (cancelled) return;
        const sortedResidents = sortResidents(nextResidents);
        setResidents(sortedResidents);
        setAvailability(nextAvailability);
        setPhases(nextPhases);
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

  function closeCalendarHelp() {
    localStorage.setItem(calendarHelpStorageKey, "true");
    setCalendarHelpOpen(false);
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

  async function savePhase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = phaseDraft.title.trim();
    if (!title) return;
    if (phaseDraft.startDate && phaseDraft.endDate && phaseDraft.endDate < phaseDraft.startDate) {
      setMessage("Das Enddatum muss nach dem Startdatum liegen.");
      return;
    }

    const existing = phases.find((phase) => phase.id === editingPhaseId);
    const saved = await client.savePhase({
      id: editingPhaseId ?? undefined,
      title,
      status: phaseDraft.status,
      startDate: phaseDraft.startDate,
      endDate: phaseDraft.endDate,
      notes: phaseDraft.notes,
      createdAt: existing?.createdAt,
    });
    setPhases((current) =>
      current.some((phase) => phase.id === saved.id)
        ? current.map((phase) => (phase.id === saved.id ? saved : phase))
        : [saved, ...current],
    );
    setPhaseDraft(emptyPhaseDraft);
    setEditingPhaseId(null);
    setMessage("");
  }

  function editPhase(phase: BuildPhase) {
    setEditingPhaseId(phase.id);
    setPhaseDraft({
      title: phase.title,
      status: phase.status,
      startDate: phase.startDate ?? "",
      endDate: phase.endDate ?? "",
      notes: phase.notes ?? "",
    });
  }

  function cancelPhaseEdit() {
    setEditingPhaseId(null);
    setPhaseDraft(emptyPhaseDraft);
  }

  async function deletePhase(phase: BuildPhase) {
    const phaseTasks = tasks.filter((task) => task.phaseId === phase.id);
    const historicalHours = hours.filter((entry) => entry.phaseId === phase.id).length;
    const detail = [
      `${phaseTasks.length} Aufgabe${phaseTasks.length === 1 ? "" : "n"}`,
      historicalHours > 0 ? `${historicalHours} bestehende Stundeneinträge bleiben erhalten` : "keine Stundeneinträge",
    ].join(", ");
    if (!window.confirm(`Bauphase „${phase.title}“ löschen? ${detail}.`)) return;

    await client.deletePhase(phase.id);
    setPhases((current) => current.filter((item) => item.id !== phase.id));
    setTasks((current) => current.filter((task) => task.phaseId !== phase.id));
    if (editingPhaseId === phase.id) cancelPhaseEdit();
    if (taskDraft?.phaseId === phase.id) setTaskDraft(null);
    if (hourDraft.phaseId === phase.id) {
      setHourDraft((current) => ({ ...current, phaseId: "", taskId: "" }));
    }
  }

  function addTask(phaseId: string) {
    setTaskDraft({ phaseId, title: "", status: "planned", estimateHours: "", notes: "" });
  }

  function editTask(task: Task) {
    setTaskDraft({
      id: task.id,
      phaseId: task.phaseId,
      title: task.title,
      status: task.status,
      estimateHours: String(task.estimateHours || ""),
      notes: task.notes ?? "",
      createdAt: task.createdAt,
    });
  }

  async function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!taskDraft?.title.trim()) return;

    const saved = await client.saveTask({
      id: taskDraft.id,
      phaseId: taskDraft.phaseId,
      title: taskDraft.title.trim(),
      status: taskDraft.status,
      estimateHours: Number(taskDraft.estimateHours || 0),
      notes: taskDraft.notes,
      createdAt: taskDraft.createdAt,
    });
    setTasks((current) =>
      current.some((task) => task.id === saved.id)
        ? current.map((task) => (task.id === saved.id ? saved : task))
        : [saved, ...current],
    );
    setTaskDraft(null);
  }

  async function deleteTask(task: Task) {
    const historicalHours = hours.filter((entry) => entry.taskId === task.id).length;
    const detail = historicalHours > 0 ? ` ${historicalHours} bestehende Stundeneinträge bleiben erhalten.` : "";
    if (!window.confirm(`Aufgabe „${task.title}“ löschen?${detail}`)) return;
    await client.deleteTask(task.id);
    setTasks((current) => current.filter((item) => item.id !== task.id));
    if (taskDraft?.id === task.id) setTaskDraft(null);
    if (hourDraft.taskId === task.id) setHourDraft((current) => ({ ...current, taskId: "" }));
  }

  async function saveHour(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(hourDraft.hours);
    if (!hourDraft.residentId || !hourDraft.date || amount <= 0) return;

    const saved = await client.saveHour({
      id: hourDraft.id,
      residentId: hourDraft.residentId,
      phaseId: hourDraft.phaseId || undefined,
      taskId: hourDraft.taskId || undefined,
      date: hourDraft.date,
      hours: amount,
      notes: hourDraft.notes,
      createdAt: hourDraft.createdAt,
    });
    setHours((current) =>
      current.some((entry) => entry.id === saved.id)
        ? current.map((entry) => (entry.id === saved.id ? saved : entry))
        : [saved, ...current],
    );
    setHourDraft(emptyHourDraft(hourDraft.residentId));
  }

  function editHour(entry: HourEntry) {
    const linkedTask = tasks.find((task) => task.id === entry.taskId);
    setHourDraft({
      id: entry.id,
      residentId: entry.residentId,
      phaseId: entry.phaseId || linkedTask?.phaseId || "",
      taskId: entry.taskId ?? "",
      date: entry.date,
      hours: String(entry.hours),
      notes: entry.notes ?? "",
      createdAt: entry.createdAt,
    });
  }

  async function deleteHour(entry: HourEntry) {
    if (!window.confirm(`Stundeneintrag vom ${entry.date} löschen?`)) return;
    await client.deleteHour(entry.id);
    setHours((current) => current.filter((item) => item.id !== entry.id));
    if (hourDraft.id === entry.id) setHourDraft(emptyHourDraft(hourDraft.residentId));
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
  const tasksForHourPhase = tasks.filter((task) => task.phaseId === hourDraft.phaseId);
  const sortedHours = [...hours].sort(
    (a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Mola di Sabot</p>
          <h1>Bauplan</h1>
        </div>
        <div className="topbar-actions">
          <nav className="tabs" aria-label="Hauptbereiche">
            <button className={tab === "calendar" ? "active" : ""} onClick={() => switchTab("calendar")}>
              <CalendarDays size={18} />
              Kalender
            </button>
            <button className={tab === "tasks" ? "active" : ""} onClick={() => switchTab("tasks")}>
              <Layers3 size={18} />
              Bauphasen
            </button>
            <button className={tab === "hours" ? "active" : ""} onClick={() => switchTab("hours")}>
              <Clock3 size={18} />
              Stunden
            </button>
          </nav>
          {tab === "calendar" && (
            <button
              className="help-button"
              type="button"
              onClick={() => setCalendarHelpOpen(true)}
              aria-label="Kalender-Anleitung öffnen"
              title="Kalender-Anleitung"
            >
              <CircleHelp size={20} />
            </button>
          )}
        </div>
      </header>

      {calendarHelpOpen && tab === "calendar" && (
        <div
          className="help-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeCalendarHelp();
          }}
        >
          <section className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="calendar-help-title">
            <header>
              <div>
                <p className="eyebrow">Kalender</p>
                <h2 id="calendar-help-title">So geht's</h2>
              </div>
              <button className="dialog-close" type="button" onClick={closeCalendarHelp} aria-label="Anleitung schließen">
                <X size={19} />
              </button>
            </header>
            <p>Wähle deine Person und klicke bei jedem Datum auf deine Verfügbarkeit:</p>
            <div className="help-options" aria-label="Verfügbarkeiten">
              <span className="red">Nein</span>
              <span className="yellow">Vielleicht</span>
              <span className="green">Ja</span>
            </div>
            <p className="help-position">
              Links rot, Mitte gelb, rechts grün. Die Symbole darunter gehören zu den Personen in der Legende.
            </p>
            <p className="help-finish">
              Danach <strong>Cloud speichern</strong>. Unter <strong>Gute Tage</strong> siehst du, wann mehrere Personen Zeit haben.
            </p>
          </section>
        </div>
      )}

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
                    {emojiForResident(resident)} {resident.name}
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

            <div className="resident-legend" aria-label="Personensymbole">
              <span className="legend-title">Personen</span>
              {residents.map((resident) => (
                <span
                  className={`legend-person ${resident.id === activeResident ? "active" : ""}`}
                  key={resident.id}
                >
                  <span className="resident-emoji" role="img" aria-label={resident.name}>
                    {emojiForResident(resident)}
                  </span>
                  {resident.name}
                </span>
              ))}
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
                      <span className="date-label">
                        <strong>{date.getDate()}</strong>
                        <small className="date-month">{formatMonthShort(date)}</small>
                        <small className="date-weekday">{formatWeekdayShort(date)}</small>
                      </span>
                      {counts.split > 0 && <em>geteilt</em>}
                    </header>

                    <div
                      className={`day-cell ${activeDay.status} ${activeDay.split ? "split" : ""}`}
                    >
                      <div className="day-zones" aria-label={`${dateKey} für ${activeResident} setzen`}>
                        {statusOptions.map((option) => (
                          <button
                            key={option.id}
                            className={`day-zone ${option.id} ${activeDay.status === option.id && !activeDay.split ? "selected" : ""}`}
                            onClick={() => setAvailabilityForDay(dateKey, option.id)}
                            title={`${option.label} setzen`}
                            aria-label={`${option.label} setzen`}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="day-status-row" aria-label="Verfügbarkeit der Personen">
                      {statusOptions.map((option) => (
                        <div className={`status-bucket ${option.id}`} key={option.id}>
                          {residents.map((resident) => {
                            const day = dayAvailabilityFor(availabilityById, dateKey, resident.id);
                            const displayStatus = day.split || day.status === "mixed" ? "yellow" : day.status;
                            if (displayStatus !== option.id) return null;
                            return (
                              <span
                                key={resident.id}
                                title={`${resident.name}: ${day.split ? "geteilt" : option.label}`}
                                className={`resident-emoji ${day.split || day.status === "mixed" ? "split" : ""}`}
                                role="img"
                                aria-label={resident.name}
                              >
                                {emojiForResident(resident)}
                              </span>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </section>
      )}

      {tab === "tasks" && (
        <section className="data-layout phase-layout">
          <form className="entry-panel phase-form" onSubmit={savePhase}>
            <h2>{editingPhaseId ? "Bauphase bearbeiten" : "Neue Bauphase"}</h2>
            <label>
              Titel
              <input
                value={phaseDraft.title}
                onChange={(event) => setPhaseDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder="Küche, Dach, Abwasser..."
                required
              />
            </label>
            <label>
              Status
              <select
                value={phaseDraft.status}
                onChange={(event) =>
                  setPhaseDraft((current) => ({ ...current, status: event.target.value as WorkStatus }))
                }
              >
                {Object.entries(taskStatusLabels).map(([value, label]) => (
                  <option value={value} key={value}>{label}</option>
                ))}
              </select>
            </label>
            <div className="date-range-fields">
              <label>
                Von
                <input
                  type="date"
                  value={phaseDraft.startDate}
                  onChange={(event) => setPhaseDraft((current) => ({ ...current, startDate: event.target.value }))}
                />
              </label>
              <label>
                Bis
                <input
                  type="date"
                  value={phaseDraft.endDate}
                  onChange={(event) => setPhaseDraft((current) => ({ ...current, endDate: event.target.value }))}
                />
              </label>
            </div>
            <label>
              Notizen
              <textarea
                rows={4}
                value={phaseDraft.notes}
                onChange={(event) => setPhaseDraft((current) => ({ ...current, notes: event.target.value }))}
              />
            </label>
            <button className="primary-action" type="submit">
              <Plus size={18} />
              {editingPhaseId ? "Änderungen speichern" : "Bauphase hinzufügen"}
            </button>
            {editingPhaseId && (
              <button className="secondary-action" type="button" onClick={cancelPhaseEdit}>
                <X size={17} />
                Abbrechen
              </button>
            )}
          </form>

          <div className="table-panel phase-board">
            <div className="section-heading">
              <div>
                <h2>Bauphasen</h2>
                <p className="muted">Aufgaben werden direkt ihrer Bauphase zugeordnet.</p>
              </div>
            </div>

            {phases.length === 0 ? (
              <p className="empty-state">Noch keine Bauphase. Lege links die erste an.</p>
            ) : (
              <div className="phase-list">
                {phases.map((phase) => {
                  const phaseTasks = tasks.filter((task) => task.phaseId === phase.id);
                  return (
                    <article className="phase-card" key={phase.id}>
                      <header className="phase-card-header">
                        <div>
                          <div className="phase-title-line">
                            <h3>{phase.title}</h3>
                            <span className={`pill ${phase.status}`}>{taskStatusLabels[phase.status]}</span>
                          </div>
                          <span className="phase-dates">
                            {phase.startDate || phase.endDate
                              ? `${phase.startDate || "offen"} – ${phase.endDate || "offen"}`
                              : "Zeitraum offen"}
                          </span>
                        </div>
                        <div className="row-actions">
                          <button className="compact-icon" type="button" onClick={() => editPhase(phase)} title="Bauphase bearbeiten" aria-label={`${phase.title} bearbeiten`}>
                            <Pencil size={16} />
                          </button>
                          <button className="compact-icon danger" type="button" onClick={() => deletePhase(phase)} title="Bauphase löschen" aria-label={`${phase.title} löschen`}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </header>

                      {phase.notes && <p className="phase-notes">{phase.notes}</p>}

                      <div className="phase-task-heading">
                        <h4>Aufgaben</h4>
                        <button className="small-action" type="button" onClick={() => addTask(phase.id)}>
                          <Plus size={15} />
                          Aufgabe
                        </button>
                      </div>

                      {taskDraft?.phaseId === phase.id && (
                        <form className="task-editor" onSubmit={saveTask}>
                          <input
                            value={taskDraft.title}
                            onChange={(event) => setTaskDraft((current) => current && ({ ...current, title: event.target.value }))}
                            placeholder="Aufgabe"
                            aria-label="Aufgabentitel"
                            required
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={taskDraft.estimateHours}
                            onChange={(event) => setTaskDraft((current) => current && ({ ...current, estimateHours: event.target.value }))}
                            placeholder="Std."
                            aria-label="Geschätzte Stunden"
                          />
                          <select
                            value={taskDraft.status}
                            onChange={(event) => setTaskDraft((current) => current && ({ ...current, status: event.target.value as WorkStatus }))}
                            aria-label="Aufgabenstatus"
                          >
                            {Object.entries(taskStatusLabels).map(([value, label]) => (
                              <option value={value} key={value}>{label}</option>
                            ))}
                          </select>
                          <input
                            value={taskDraft.notes}
                            onChange={(event) => setTaskDraft((current) => current && ({ ...current, notes: event.target.value }))}
                            placeholder="Notiz"
                            aria-label="Aufgabennotiz"
                          />
                          <div className="editor-actions">
                            <button className="small-action primary" type="submit">Speichern</button>
                            <button className="compact-icon" type="button" onClick={() => setTaskDraft(null)} aria-label="Abbrechen" title="Abbrechen">
                              <X size={16} />
                            </button>
                          </div>
                        </form>
                      )}

                      <div className="phase-tasks">
                        {phaseTasks.length === 0 ? (
                          <p className="muted task-empty">Noch keine Aufgaben.</p>
                        ) : (
                          phaseTasks.map((task) => (
                            <div className="phase-task-row" key={task.id}>
                              <div>
                                <strong>{task.title}</strong>
                                <span>
                                  {task.estimateHours ? `${task.estimateHours}h geschätzt` : "keine Schätzung"}
                                  {task.notes ? ` · ${task.notes}` : ""}
                                </span>
                              </div>
                              <span className={`pill ${task.status}`}>{taskStatusLabels[task.status]}</span>
                              <div className="row-actions">
                                <button className="compact-icon" type="button" onClick={() => editTask(task)} aria-label={`${task.title} bearbeiten`} title="Aufgabe bearbeiten">
                                  <Pencil size={15} />
                                </button>
                                <button className="compact-icon danger" type="button" onClick={() => deleteTask(task)} aria-label={`${task.title} löschen`} title="Aufgabe löschen">
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {tab === "hours" && (
        <section className="data-layout">
          <form className="entry-panel" onSubmit={saveHour}>
            <h2>{hourDraft.id ? "Eintrag bearbeiten" : "Stunden eintragen"}</h2>
            <label>
              Person
              <select
                value={hourDraft.residentId}
                onChange={(event) => setHourDraft((current) => ({ ...current, residentId: event.target.value }))}
              >
                {residents.map((resident) => (
                  <option key={resident.id} value={resident.id}>
                    {emojiForResident(resident)} {resident.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Bauphase
              <select
                value={hourDraft.phaseId}
                onChange={(event) =>
                  setHourDraft((current) => ({ ...current, phaseId: event.target.value, taskId: "" }))
                }
              >
                <option value="">Keine Bauphase</option>
                {phases.map((phase) => (
                  <option key={phase.id} value={phase.id}>{phase.title}</option>
                ))}
              </select>
            </label>
            <label>
              Aufgabe
              <select
                value={hourDraft.taskId}
                disabled={!hourDraft.phaseId}
                onChange={(event) => setHourDraft((current) => ({ ...current, taskId: event.target.value }))}
              >
                <option value="">
                  {hourDraft.phaseId ? "Allgemeine Arbeit in der Bauphase" : "Zuerst Bauphase wählen"}
                </option>
                {tasksForHourPhase.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Datum
              <input
                type="date"
                value={hourDraft.date}
                onChange={(event) => setHourDraft((current) => ({ ...current, date: event.target.value }))}
                required
              />
            </label>
            <label>
              Stunden
              <input
                type="number"
                min="0.25"
                step="0.25"
                value={hourDraft.hours}
                onChange={(event) => setHourDraft((current) => ({ ...current, hours: event.target.value }))}
                placeholder="3.5"
                required
              />
            </label>
            <label>
              Notizen
              <textarea
                rows={4}
                value={hourDraft.notes}
                onChange={(event) => setHourDraft((current) => ({ ...current, notes: event.target.value }))}
              />
            </label>
            <button className="primary-action" type="submit">
              <Plus size={18} />
              {hourDraft.id ? "Änderungen speichern" : "Stunden hinzufügen"}
            </button>
            {hourDraft.id && (
              <button className="secondary-action" type="button" onClick={() => setHourDraft(emptyHourDraft(hourDraft.residentId))}>
                <X size={17} />
                Abbrechen
              </button>
            )}
          </form>

          <div className="table-panel">
            <h2>Summen</h2>
            <div className="totals-grid">
              {totalsByResident.map(({ resident, hours }) => (
                <div className="total-card" key={resident.id}>
                  <span className="resident-emoji" role="img" aria-label={resident.name}>
                    {emojiForResident(resident)}
                  </span>
                  <strong>{resident.name}</strong>
                  <span>{hours.toFixed(1)}h</span>
                </div>
              ))}
            </div>

            <h2>Einträge</h2>
            <div className="hour-list">
              {sortedHours.length === 0 ? (
                <p className="empty-state">Noch keine Stunden eingetragen.</p>
              ) : sortedHours.map((entry) => {
                const resident = residents.find((item) => item.id === entry.residentId);
                const phase = phases.find((item) => item.id === entry.phaseId);
                const task = tasks.find((item) => item.id === entry.taskId);
                const context = [
                  phase?.title ?? (entry.phaseId ? "Gelöschte Bauphase" : "Allgemeine Arbeit"),
                  task?.title ?? (entry.taskId ? "Gelöschte Aufgabe" : ""),
                ].filter(Boolean).join(" · ");
                return (
                  <article className="hour-row" key={entry.id}>
                    <div className="hour-person">
                      {resident && <span className="resident-emoji" role="img" aria-label={resident.name}>{emojiForResident(resident)}</span>}
                      <div>
                        <strong>{resident?.name ?? "Person"}</strong>
                        <span>{entry.date} · {context}</span>
                        {entry.notes && <small>{entry.notes}</small>}
                      </div>
                    </div>
                    <strong className="hour-value">{entry.hours}h</strong>
                    <div className="row-actions">
                      <button className="compact-icon" type="button" onClick={() => editHour(entry)} aria-label="Stundeneintrag bearbeiten" title="Bearbeiten">
                        <Pencil size={15} />
                      </button>
                      <button className="compact-icon danger" type="button" onClick={() => deleteHour(entry)} aria-label="Stundeneintrag löschen" title="Löschen">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </article>
                );
              })}
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
