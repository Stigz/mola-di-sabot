variable "project_name" {
  description = "Project slug used for AWS resource names."
  type        = string
  default     = "mola-di-sabot"
}

variable "environment" {
  description = "Environment name."
  type        = string
  default     = "dev"
}

variable "aws_region" {
  description = "AWS region for backend resources."
  type        = string
  default     = "eu-central-1"
}

variable "lambda_zip_path" {
  description = "Path to the built Lambda zip."
  type        = string
  default     = "../../backend/dist/bootstrap.zip"
}

variable "frontend_origins" {
  description = "Allowed browser origins for the API."
  type        = list(string)
  default     = ["http://localhost:5173"]
}

variable "monthly_budget_usd" {
  description = "Set to 0 to skip the monthly budget alert."
  type        = number
  default     = 5
}

variable "budget_alert_email" {
  description = "Email address for budget alerts. Leave empty to skip the budget resource."
  type        = string
  default     = ""
}

