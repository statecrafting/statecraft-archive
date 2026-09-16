terraform {
  required_version = ">= 1.5.7"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.110"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.11"
    }
  }
}
