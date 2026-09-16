Q: Terraform destroy is taking forever.
A: NetworkWatcherRG is not created by Terraform as it’s a subscription-level “default” resource group that Azure auto-creates
   when Network Watcher is enabled for a region.
   Because it’s not in Terraform state, terraform destroy will never touch it but its existence will prevent a clean removal.
 

To resolve the issue, disable Network Watcher for that region, then delete the RG
Using Azure CLI:
```
# Disable Network Watcher in the region
az network watcher configure --enabled false --locations canadacentral

# Delete the auto-created RG
az group delete --name NetworkWatcherRG --yes --no-wait
az group delete --name statecraft-dev-rg --yes --no-wait
```
