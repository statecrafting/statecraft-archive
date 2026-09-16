# Placeholders

When using **acme-vue-encore** as a starting point for a new project, several placeholders need to be replaced with your actual project details.

This list is also maintained in the `PLACEHOLDERS.md` file in the repository root.

## Global Replacements

You should perform a global find-and-replace for the following strings:

- **`acme-vue-encore`**: Replace with your project's internal identifier (e.g., `my-company-app`).
- **`@template`**: The npm workspace scope. Replace with your organization's scope (e.g., `@myorg`).
- **`statecrafting`**: The GitHub organization name.
- **`template-encore`**: The GitHub repository name.

## Configuration Updates

Update the following files with your specific configuration:

1. **`package.json`**: Update the `name`, `description`, `repository`, and `author` fields.
2. **`apps/api/encore.app`**: Update the Encore application ID if you are deploying to the Encore cloud.
3. **`apps/api/.env.example`**: Update the default values to reflect your project's requirements.
4. **`.github/workflows/encore-cd.yml.example`**: Update the container registry URL and image name.

## Auth Configuration

If you are using the `rauthy` driver in production, ensure you update the `RAUTHY_ISSUER` and `RAUTHY_REDIRECT_URI` environment variables to point to your actual IdP and application domain.
