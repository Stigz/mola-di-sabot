package app

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"
)

type Handler struct {
	store          Store
	allowedOrigins []string
}

func NewHandler(store Store) *Handler {
	origins := strings.Split(os.Getenv("ALLOWED_ORIGIN"), ",")
	if len(origins) == 1 && origins[0] == "" {
		origins = []string{"*"}
	}
	return &Handler{
		store:          store,
		allowedOrigins: origins,
	}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.addCORS(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/health":
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	case r.Method == http.MethodGet && r.URL.Path == "/residents":
		h.listResidents(w, r)
	case r.URL.Path == "/availability":
		h.handleAvailability(w, r)
	case r.URL.Path == "/tasks":
		h.handleTasks(w, r)
	case r.URL.Path == "/hours":
		h.handleHours(w, r)
	default:
		writeError(w, http.StatusNotFound, "not found")
	}
}

func (h *Handler) listResidents(w http.ResponseWriter, r *http.Request) {
	residents, err := h.store.ListResidents(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, residents)
}

func (h *Handler) handleAvailability(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		from, to, err := parseRange(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		entries, err := h.store.ListAvailability(r.Context(), from, to)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, entries)
	case http.MethodPut:
		var entry AvailabilityEntry
		if err := json.NewDecoder(r.Body).Decode(&entry); err != nil {
			writeError(w, http.StatusBadRequest, "invalid availability payload")
			return
		}
		if err := validateAvailability(entry); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := h.store.PutAvailability(r.Context(), entry); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		entry.ID = availabilityKey(entry)
		entry.UpdatedAt = nowString()
		writeJSON(w, http.StatusOK, entry)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *Handler) handleTasks(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		tasks, err := h.store.ListTasks(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, tasks)
	case http.MethodPost, http.MethodPatch:
		var task Task
		if err := json.NewDecoder(r.Body).Decode(&task); err != nil {
			writeError(w, http.StatusBadRequest, "invalid task payload")
			return
		}
		if strings.TrimSpace(task.Title) == "" {
			writeError(w, http.StatusBadRequest, "title is required")
			return
		}
		now := nowString()
		if task.ID == "" {
			task.ID = randomID("task")
			task.CreatedAt = now
		}
		if task.Status == "" {
			task.Status = "planned"
		}
		task.UpdatedAt = now
		if err := h.store.PutTask(r.Context(), task); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, task)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *Handler) handleHours(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		from, to, err := parseRange(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		entries, err := h.store.ListHours(r.Context(), from, to)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, entries)
	case http.MethodPost:
		var entry HourEntry
		if err := json.NewDecoder(r.Body).Decode(&entry); err != nil {
			writeError(w, http.StatusBadRequest, "invalid hour payload")
			return
		}
		if entry.ResidentID == "" || entry.Date == "" || entry.Hours <= 0 {
			writeError(w, http.StatusBadRequest, "residentId, date, and positive hours are required")
			return
		}
		if _, err := parseDate(entry.Date); err != nil {
			writeError(w, http.StatusBadRequest, "date must use YYYY-MM-DD")
			return
		}
		entry.ID = randomID("hour")
		entry.CreatedAt = nowString()
		if err := h.store.PutHour(r.Context(), entry); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, entry)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func parseRange(r *http.Request) (time.Time, time.Time, error) {
	fromRaw := r.URL.Query().Get("from")
	toRaw := r.URL.Query().Get("to")
	if fromRaw == "" || toRaw == "" {
		now := time.Now()
		return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC),
			time.Date(now.Year(), now.Month()+1, 0, 0, 0, 0, 0, time.UTC),
			nil
	}

	from, err := parseDate(fromRaw)
	if err != nil {
		return time.Time{}, time.Time{}, errors.New("from must use YYYY-MM-DD")
	}
	to, err := parseDate(toRaw)
	if err != nil {
		return time.Time{}, time.Time{}, errors.New("to must use YYYY-MM-DD")
	}
	if to.Before(from) {
		return time.Time{}, time.Time{}, errors.New("to must be after from")
	}
	return from, to, nil
}

func validateAvailability(entry AvailabilityEntry) error {
	if entry.ResidentID == "" {
		return errors.New("residentId is required")
	}
	if _, err := parseDate(entry.Date); err != nil {
		return errors.New("date must use YYYY-MM-DD")
	}
	if entry.Period != PeriodMorning && entry.Period != PeriodAfternoon {
		return errors.New("period must be morning or afternoon")
	}
	if entry.Status != StatusGreen && entry.Status != StatusYellow && entry.Status != StatusRed {
		return errors.New("status must be green, yellow, or red")
	}
	return nil
}

func (h *Handler) addCORS(w http.ResponseWriter, r *http.Request) {
	origin := "*"
	requestOrigin := r.Header.Get("Origin")
	for _, allowed := range h.allowedOrigins {
		allowed = strings.TrimSpace(allowed)
		if allowed == "*" || allowed == requestOrigin {
			origin = allowed
			if allowed == requestOrigin {
				break
			}
		}
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS")
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func randomID(prefix string) string {
	var bytes [6]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return prefix + "-" + time.Now().UTC().Format("20060102150405")
	}
	return prefix + "-" + hex.EncodeToString(bytes[:])
}
