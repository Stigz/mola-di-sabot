package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSyncSnapshotRoundTrip(t *testing.T) {
	handler := NewHandler(NewMemoryStore())

	getBefore := httptest.NewRecorder()
	handler.ServeHTTP(getBefore, httptest.NewRequest(http.MethodGet, "/sync", nil))
	if getBefore.Code != http.StatusOK {
		t.Fatalf("GET /sync before save status = %d", getBefore.Code)
	}
	if body := getBefore.Body.String(); body != "null\n" {
		t.Fatalf("GET /sync before save body = %q", body)
	}

	payload := AppState{
		Residents: []Resident{{ID: "nic", Name: "Nic", Color: "#2563eb"}},
		Availability: []AvailabilityEntry{{
			ResidentID: "nic",
			Date:       "2026-07-12",
			Period:     PeriodMorning,
			Status:     StatusGreen,
		}},
		Tasks: []Task{{ID: "task-1", Title: "Dach", Status: "planned"}},
		Hours: []HourEntry{{
			ID:         "hour-1",
			ResidentID: "nic",
			Date:       "2026-07-12",
			Hours:      2,
		}},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}

	put := httptest.NewRecorder()
	handler.ServeHTTP(put, httptest.NewRequest(http.MethodPut, "/sync", bytes.NewReader(body)))
	if put.Code != http.StatusOK {
		t.Fatalf("PUT /sync status = %d body = %s", put.Code, put.Body.String())
	}

	var saved AppState
	if err := json.NewDecoder(put.Body).Decode(&saved); err != nil {
		t.Fatal(err)
	}
	if saved.SavedAt == "" {
		t.Fatal("saved snapshot missing SavedAt")
	}
	if len(saved.Availability) != 1 || saved.Availability[0].Status != StatusGreen {
		t.Fatalf("saved availability = %#v", saved.Availability)
	}

	getAfter := httptest.NewRecorder()
	handler.ServeHTTP(getAfter, httptest.NewRequest(http.MethodGet, "/sync", nil))
	if getAfter.Code != http.StatusOK {
		t.Fatalf("GET /sync after save status = %d", getAfter.Code)
	}

	var loaded AppState
	if err := json.NewDecoder(getAfter.Body).Decode(&loaded); err != nil {
		t.Fatal(err)
	}
	if loaded.SavedAt != saved.SavedAt {
		t.Fatalf("loaded SavedAt = %q, want %q", loaded.SavedAt, saved.SavedAt)
	}
}
