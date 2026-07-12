# Architecture

## Chosen Hosting Split

The best fit for this project is:

- Cloudflare Pages for the React frontend.
- AWS Lambda, API Gateway, DynamoDB, and Cognito for private app services.
- Terraform for AWS infrastructure.
- GitHub for repository hosting, CI, and deployment workflows.

This keeps the visible website cheap and simple while keeping the parts with private data in AWS.

## App Shape

The first version has three working areas:

- Calendar: month and week views with AM/PM availability per resident.
- Tasks: simple work packages with estimates and planned dates.
- Hours: per-person hour entries tied to tasks or general work.

The frontend can run in browser-local mode without an API. Setting `VITE_API_BASE_URL` moves reads and writes to the Go backend.

## Data Model

DynamoDB uses one table with `PK` and `SK` keys:

- `RESIDENTS` stores resident profiles.
- `AVAIL#YYYY-MM-DD` stores availability cells.
- `TASKS` stores task records.
- `HOURS#YYYY-MM-DD` stores hour entries.

This is deliberately compact for six people and keeps AWS costs low.

