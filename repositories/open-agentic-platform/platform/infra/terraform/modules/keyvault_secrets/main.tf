resource "azurerm_key_vault_secret" "this" {
  # 1. Iterate over just the keys, marking them as safe to display
  for_each = toset(nonsensitive(keys(var.secrets)))

  key_vault_id = var.keyvault_id

  # Key Vault secret names: only [0-9A-Za-z-]
  # Convert underscores to dashes (and optionally normalize case)
  name = lower(replace(each.key, "_", "-"))

  # 2. Look up the sensitive value from the original map using the key
  value = var.secrets[each.key]
}
