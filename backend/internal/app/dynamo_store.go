package app

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type DynamoStore struct {
	client *dynamodb.Client
	table  string
}

type dbRecord struct {
	PK   string `dynamodbav:"PK"`
	SK   string `dynamodbav:"SK"`
	Type string `dynamodbav:"Type"`
	Data string `dynamodbav:"Data"`
}

func NewDynamoStore(client *dynamodb.Client, table string) *DynamoStore {
	return &DynamoStore{client: client, table: table}
}

func (s *DynamoStore) ListResidents(ctx context.Context) ([]Resident, error) {
	records, err := s.queryPK(ctx, "RESIDENTS")
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return defaultResidents(), nil
	}

	var residents []Resident
	for _, record := range records {
		var resident Resident
		if err := json.Unmarshal([]byte(record.Data), &resident); err != nil {
			return nil, err
		}
		residents = append(residents, resident)
	}
	return residents, nil
}

func (s *DynamoStore) ListAvailability(ctx context.Context, from time.Time, to time.Time) ([]AvailabilityEntry, error) {
	var entries []AvailabilityEntry
	for _, date := range dateRange(from, to) {
		records, err := s.queryPK(ctx, "AVAIL#"+date.Format("2006-01-02"))
		if err != nil {
			return nil, err
		}
		for _, record := range records {
			var entry AvailabilityEntry
			if err := json.Unmarshal([]byte(record.Data), &entry); err != nil {
				return nil, err
			}
			entries = append(entries, entry)
		}
	}
	return entries, nil
}

func (s *DynamoStore) PutAvailability(ctx context.Context, entry AvailabilityEntry) error {
	entry.ID = availabilityKey(entry)
	entry.UpdatedAt = nowString()
	return s.put(ctx, "AVAIL#"+entry.Date, entry.ID, "availability", entry)
}

func (s *DynamoStore) ListTasks(ctx context.Context) ([]Task, error) {
	records, err := s.queryPK(ctx, "TASKS")
	if err != nil {
		return nil, err
	}

	var tasks []Task
	for _, record := range records {
		var task Task
		if err := json.Unmarshal([]byte(record.Data), &task); err != nil {
			return nil, err
		}
		tasks = append(tasks, task)
	}
	return tasks, nil
}

func (s *DynamoStore) PutTask(ctx context.Context, task Task) error {
	return s.put(ctx, "TASKS", task.ID, "task", task)
}

func (s *DynamoStore) ListHours(ctx context.Context, from time.Time, to time.Time) ([]HourEntry, error) {
	var entries []HourEntry
	for _, date := range dateRange(from, to) {
		records, err := s.queryPK(ctx, "HOURS#"+date.Format("2006-01-02"))
		if err != nil {
			return nil, err
		}
		for _, record := range records {
			var entry HourEntry
			if err := json.Unmarshal([]byte(record.Data), &entry); err != nil {
				return nil, err
			}
			entries = append(entries, entry)
		}
	}
	return entries, nil
}

func (s *DynamoStore) PutHour(ctx context.Context, entry HourEntry) error {
	return s.put(ctx, "HOURS#"+entry.Date, entry.ID, "hour", entry)
}

func (s *DynamoStore) put(ctx context.Context, pk string, sk string, itemType string, payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	item, err := attributevalue.MarshalMap(dbRecord{
		PK:   pk,
		SK:   sk,
		Type: itemType,
		Data: string(data),
	})
	if err != nil {
		return err
	}

	_, err = s.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(s.table),
		Item:      item,
	})
	return err
}

func (s *DynamoStore) queryPK(ctx context.Context, pk string) ([]dbRecord, error) {
	output, err := s.client.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(s.table),
		KeyConditionExpression: aws.String("PK = :pk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk": &types.AttributeValueMemberS{Value: pk},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("query %s: %w", pk, err)
	}

	var records []dbRecord
	if err := attributevalue.UnmarshalListOfMaps(output.Items, &records); err != nil {
		return nil, err
	}
	return records, nil
}

