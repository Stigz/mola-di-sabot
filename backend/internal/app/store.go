package app

import (
	"context"
	"os"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

func NewStore(ctx context.Context) (Store, error) {
	table := os.Getenv("DYNAMODB_TABLE")
	if table == "" {
		return NewMemoryStore(), nil
	}

	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, err
	}

	return NewDynamoStore(dynamodb.NewFromConfig(cfg), table), nil
}

