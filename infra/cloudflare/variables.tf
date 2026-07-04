variable "cloudflare_zone_id" {
  description = <<-EOT
    Cloudflare Zone ID for the production domain.

    Find it at: Cloudflare dashboard -> your domain -> Overview (right sidebar).
    This is the SAME value as CLOUDFLARE_ZONE_ID in the app's own .env
    (used by app/api/revalidate/route.ts to purge specific URLs on publish).
    That is a coincidence of both needing the zone ID, not a dependency between
    the app and this Terraform module.
  EOT
  type = string
}

variable "cloudflare_api_token" {
  description = <<-EOT
    Cloudflare API token used ONLY by `terraform apply` to manage this zone's
    Cache Rules. This is a separate credential from CLOUDFLARE_PURGE_API_TOKEN
    in the app's .env:

      - CLOUDFLARE_PURGE_API_TOKEN (app runtime, used by /api/revalidate)
          required permission: Zone -> Cache Purge -> Edit

      - cloudflare_api_token (this Terraform module, run by a human/CI)
          required permission: Zone -> Cache Rules -> Edit

    Create a new, narrowly-scoped token at
    https://dash.cloudflare.com/profile/api-tokens rather than reusing the
    purge token or a Global API Key. Scope it to the single zone, not "All
    zones", and never commit it — pass it via -var, a *.auto.tfvars file that
    is gitignored, TF_VAR_cloudflare_api_token, or your CI secret store.
  EOT
  type      = string
  sensitive = true
}
