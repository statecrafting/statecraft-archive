{{/*
Expand the name of the chart.
*/}}
{{- define "acme-vue-encore.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Fully qualified app name. deployd sets .Values.fullnameOverride at deploy
time to the per-variant app slug ({projectSlug}-{variant}, spec 214 FR-009)
so release and gate names stay disjoint between variants of one environment.
*/}}
{{- define "acme-vue-encore.fullname" -}}
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

{{/*
Deterministic in-namespace Postgres Service name (spec 214 FR-006). The
tenant image's baked infra.config.json targets this host for the preview DB.
*/}}
{{- define "acme-vue-encore.postgresName" -}}
{{- printf "%s-postgres" (include "acme-vue-encore.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Deterministic in-namespace Redis Service name (spec 227 FR-005). The tenant
image's baked infra.config.json redis block targets this host for the preview
cache, mirroring the postgresName pattern above.
*/}}
{{- define "acme-vue-encore.redisName" -}}
{{- printf "%s-redis" (include "acme-vue-encore.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Common labels shared across every rendered object.
*/}}
{{- define "acme-vue-encore.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "acme-vue-encore.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
oap.spec: "214-tenant-app-chart-supersession"
{{- end -}}

{{/*
Selector labels: a stable subset of the full labels.
*/}}
{{- define "acme-vue-encore.selectorLabels" -}}
app.kubernetes.io/name: {{ include "acme-vue-encore.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
ServiceAccount name: chart-managed when serviceAccount.create == true,
otherwise the operator-supplied value.
*/}}
{{- define "acme-vue-encore.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "acme-vue-encore.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}
