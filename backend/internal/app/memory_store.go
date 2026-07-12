package app

import (
	"context"
	"sync"
	"time"
)

type MemoryStore struct {
	mu           sync.RWMutex
	residents    []Resident
	availability map[string]AvailabilityEntry
	tasks        map[string]Task
	hours        map[string]HourEntry
	snapshot     *AppState
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		residents:    defaultResidents(),
		availability: map[string]AvailabilityEntry{},
		tasks:        map[string]Task{},
		hours:        map[string]HourEntry{},
	}
}

func (s *MemoryStore) ListResidents(context.Context) ([]Resident, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]Resident(nil), s.residents...), nil
}

func (s *MemoryStore) ListAvailability(_ context.Context, from time.Time, to time.Time) ([]AvailabilityEntry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var entries []AvailabilityEntry
	for _, entry := range s.availability {
		date, err := parseDate(entry.Date)
		if err != nil {
			continue
		}
		if !date.Before(from) && !date.After(to) {
			entries = append(entries, entry)
		}
	}
	return entries, nil
}

func (s *MemoryStore) PutAvailability(_ context.Context, entry AvailabilityEntry) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	entry.ID = availabilityKey(entry)
	entry.UpdatedAt = nowString()
	s.availability[entry.ID] = entry
	return nil
}

func (s *MemoryStore) ListTasks(context.Context) ([]Task, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	tasks := make([]Task, 0, len(s.tasks))
	for _, task := range s.tasks {
		tasks = append(tasks, task)
	}
	return tasks, nil
}

func (s *MemoryStore) PutTask(_ context.Context, task Task) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tasks[task.ID] = task
	return nil
}

func (s *MemoryStore) ListHours(_ context.Context, from time.Time, to time.Time) ([]HourEntry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var entries []HourEntry
	for _, entry := range s.hours {
		date, err := parseDate(entry.Date)
		if err != nil {
			continue
		}
		if !date.Before(from) && !date.After(to) {
			entries = append(entries, entry)
		}
	}
	return entries, nil
}

func (s *MemoryStore) PutHour(_ context.Context, entry HourEntry) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.hours[entry.ID] = entry
	return nil
}

func (s *MemoryStore) GetSnapshot(context.Context) (AppState, bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.snapshot == nil {
		return AppState{}, false, nil
	}
	return *s.snapshot, true, nil
}

func (s *MemoryStore) PutSnapshot(_ context.Context, state AppState) (AppState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	next := normalizeSnapshot(state)
	s.snapshot = &next
	return next, nil
}
