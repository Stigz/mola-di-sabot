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

type Store interface {
	ListResidents(ctx context.Context) ([]Resident, error)
	ListAvailability(ctx context.Context, from time.Time, to time.Time) ([]AvailabilityEntry, error)
	PutAvailability(ctx context.Context, entry AvailabilityEntry) error
	ListTasks(ctx context.Context) ([]Task, error)
	PutTask(ctx context.Context, task Task) error
	ListHours(ctx context.Context, from time.Time, to time.Time) ([]HourEntry, error)
	PutHour(ctx context.Context, entry HourEntry) error
}

func defaultResidents() []Resident {
	return []Resident{
		{ID: "nicolas", Name: "Nicolas", Color: "#2563eb"},
		{ID: "resident-2", Name: "Resident 2", Color: "#16a34a"},
		{ID: "resident-3", Name: "Resident 3", Color: "#dc2626"},
		{ID: "resident-4", Name: "Resident 4", Color: "#9333ea"},
		{ID: "resident-5", Name: "Resident 5", Color: "#ea580c"},
		{ID: "resident-6", Name: "Resident 6", Color: "#0891b2"},
	}
}

func availabilityKey(entry AvailabilityEntry) string {
	return fmt.Sprintf("%s:%s:%s", entry.Date, entry.Period, entry.ResidentID)
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

