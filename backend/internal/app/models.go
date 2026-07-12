package app

import (
	"context"
	"fmt"
	"time"
)

type AvailabilityStatus string

const (
	StatusGreen  AvailabilityStatus = "green"
	StatusYellow AvailabilityStatus = "yellow"
	StatusRed    AvailabilityStatus = "red"
)

type Period string

const (
	PeriodMorning   Period = "morning"
	PeriodAfternoon Period = "afternoon"
)

type Resident struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type AvailabilityEntry struct {
	ID         string             `json:"id,omitempty"`
	ResidentID string             `json:"residentId"`
	Date       string             `json:"date"`
	Period     Period             `json:"period"`
	Status     AvailabilityStatus `json:"status"`
	UpdatedAt  string             `json:"updatedAt,omitempty"`
}

type Task struct {
	ID            string  `json:"id"`
	Title         string  `json:"title"`
	Status        string  `json:"status"`
	EstimateHours float64 `json:"estimateHours"`
	PlannedDate   string  `json:"plannedDate,omitempty"`
	Notes         string  `json:"notes,omitempty"`
	CreatedAt     string  `json:"createdAt,omitempty"`
	UpdatedAt     string  `json:"updatedAt,omitempty"`
}

type HourEntry struct {
	ID         string  `json:"id"`
	ResidentID string  `json:"residentId"`
	TaskID     string  `json:"taskId,omitempty"`
	Date       string  `json:"date"`
	Hours      float64 `json:"hours"`
	Notes      string  `json:"notes,omitempty"`
	CreatedAt  string  `json:"createdAt,omitempty"`
}

type AppState struct {
	Residents    []Resident          `json:"residents"`
	Availability []AvailabilityEntry `json:"availability"`
	Tasks        []Task              `json:"tasks"`
	Hours        []HourEntry         `json:"hours"`
	SavedAt      string              `json:"savedAt,omitempty"`
}

type Store interface {
	ListResidents(ctx context.Context) ([]Resident, error)
	ListAvailability(ctx context.Context, from time.Time, to time.Time) ([]AvailabilityEntry, error)
	PutAvailability(ctx context.Context, entry AvailabilityEntry) error
	ListTasks(ctx context.Context) ([]Task, error)
	PutTask(ctx context.Context, task Task) error
	ListHours(ctx context.Context, from time.Time, to time.Time) ([]HourEntry, error)
	PutHour(ctx context.Context, entry HourEntry) error
	GetSnapshot(ctx context.Context) (AppState, bool, error)
	PutSnapshot(ctx context.Context, state AppState) (AppState, error)
}

func defaultResidents() []Resident {
	return []Resident{
		{ID: "doma", Name: "Domä", Color: "#9333ea"},
		{ID: "giulio", Name: "Giulio", Color: "#ea580c"},
		{ID: "lars", Name: "Lars", Color: "#16a34a"},
		{ID: "lisa", Name: "Lisa", Color: "#dc2626"},
		{ID: "nic", Name: "Nic", Color: "#2563eb"},
		{ID: "nico", Name: "Nico", Color: "#0891b2"},
	}
}

func availabilityKey(entry AvailabilityEntry) string {
	return fmt.Sprintf("%s:%s:%s", entry.Date, entry.Period, entry.ResidentID)
}

func normalizeSnapshot(state AppState) AppState {
	if len(state.Residents) == 0 {
		state.Residents = defaultResidents()
	}
	if state.Availability == nil {
		state.Availability = []AvailabilityEntry{}
	}
	if state.Tasks == nil {
		state.Tasks = []Task{}
	}
	if state.Hours == nil {
		state.Hours = []HourEntry{}
	}
	state.SavedAt = nowString()
	return state
}

func parseDate(value string) (time.Time, error) {
	return time.Parse("2006-01-02", value)
}

func dateRange(from time.Time, to time.Time) []time.Time {
	if to.Before(from) {
		return nil
	}
	var dates []time.Time
	for cursor := from; !cursor.After(to); cursor = cursor.AddDate(0, 0, 1) {
		dates = append(dates, cursor)
	}
	return dates
}

func nowString() string {
	return time.Now().UTC().Format(time.RFC3339)
}
