{{/*
Expand the name of the chart.
*/}}
{{- define "oauth2-proxy-gate.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Fully qualified app name. Deployd-api sets
`.Values.fullnameOverride` to a stable per-environment identifier
(e.g. `tenant-gate-<env-slug>`) so resource names are predictable
across reconciles.
*/}}
{{- define "oauth2-proxy-gate.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "oauth2-proxy-gate.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "oauth2-proxy-gate.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
oap.spec: "137-tenant-environment-access-gates"
{{- end -}}

{{- define "oauth2-proxy-gate.selectorLabels" -}}
app.kubernetes.io/name: {{ include "oauth2-proxy-gate.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "oauth2-proxy-gate.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "oauth2-proxy-gate.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/*
Secret name carrying COOKIE_SECRET + CLIENT_SECRET. Mounted into the
proxy via env-from + --client-secret-file/--cookie-secret-file flags
so secrets never appear in argv (`ps`).
*/}}
{{- define "oauth2-proxy-gate.secretName" -}}
{{- printf "%s-secrets" (include "oauth2-proxy-gate.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
ConfigMap name carrying the allowed-emails file. Domain allowlist
flows through repeated `--email-domain=` args (oauth2-proxy native).
*/}}
{{- define "oauth2-proxy-gate.configMapName" -}}
{{- printf "%s-allowlist" (include "oauth2-proxy-gate.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
