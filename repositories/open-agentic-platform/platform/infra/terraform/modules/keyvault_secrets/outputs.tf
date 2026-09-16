output "secret_name_map" {
  value = {
    for k in nonsensitive(keys(var.secrets)) :
    k => replace(k, "_", "-")
  }
}
