package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/awslabs/aws-lambda-go-api-proxy/httpadapter"

	"mola-di-sabot/backend/internal/app"
)

func main() {
	ctx := context.Background()
	store, err := app.NewStore(ctx)
	if err != nil {
		log.Fatalf("create store: %v", err)
	}

	handler := app.NewHandler(store)
	if os.Getenv("AWS_LAMBDA_FUNCTION_NAME") != "" {
		lambda.Start(httpadapter.NewV2(handler).ProxyWithContext)
		return
	}

	addr := os.Getenv("HTTP_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	log.Printf("Mola API listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, handler))
}

