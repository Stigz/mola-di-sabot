output "api_url" {
  description = "HTTP API base URL for VITE_API_BASE_URL."
  value       = aws_apigatewayv2_api.api.api_endpoint
}

output "dynamodb_table_name" {
  value = aws_dynamodb_table.app.name
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.app.id
}

output "cognito_web_client_id" {
  value = aws_cognito_user_pool_client.web.id
}

