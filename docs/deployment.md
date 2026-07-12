# Deployment

## Frontend: GitHub Pages

The current live deployment uses GitHub Pages:

```txt
https://stigz.github.io/mola-di-sabot/
```

The GitHub Actions workflow builds the frontend with:

```txt
VITE_BASE_PATH=/mola-di-sabot/
```

## Frontend: Cloudflare Pages

1. Push this repository to GitHub.
2. Create a Cloudflare Pages project connected to the GitHub repo.
3. Set the project root to `frontend`.
4. Use `npm run build` as the build command.
5. Use `dist` as the output directory.

Cloudflare will give the app a free URL like:

```txt
https://mola-di-sabot.pages.dev
```

After the AWS backend is deployed, set this Cloudflare Pages environment variable:

```txt
VITE_API_BASE_URL=<api_url_from_terraform>
```

## Backend: AWS

Build the Lambda zip:

```sh
npm run lambda:build
```

Initialize and apply Terraform:

```sh
cd infra/aws
terraform init
terraform apply
```

Terraform prints `api_url`. Add that value to Cloudflare Pages as `VITE_API_BASE_URL`.

## Custom Domain

A true custom domain such as `moladisabot.com` or `moladisabot.ch` requires buying the domain. Once owned, connect it to Cloudflare Pages through Cloudflare DNS or your domain registrar.

Free options remain available:

- `mola-di-sabot.pages.dev`
- `github-username.github.io/mola-di-sabot`

## Cost Guardrails

The AWS setup uses small serverless resources:

- Lambda on `arm64` with 128 MB memory.
- DynamoDB provisioned at 1 read and 1 write capacity unit.
- Optional AWS Budget alert, enabled only when `budget_alert_email` is set.
