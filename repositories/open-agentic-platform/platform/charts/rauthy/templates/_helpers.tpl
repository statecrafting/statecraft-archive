{{- define "rauthy.name" -}}
rauthy
{{- end -}}

{{- define "rauthy.fullname" -}}
{{- if .Release.Name | eq "rauthy" -}}
rauthy
{{- else -}}
{{ .Release.Name }}-rauthy
{{- end -}}
{{- end -}}

{{- define "rauthy.labels" -}}
app.kubernetes.io/name: {{ include "rauthy.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "rauthy.selectorLabels" -}}
app: {{ include "rauthy.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
Headless service name used for Raft peer discovery.
*/}}
{{- define "rauthy.headlessName" -}}
{{ include "rauthy.fullname" . }}-headless
{{- end -}}

{{/*
Compute the HQL_NODES value: space-separated list of
<pod>.<headless-svc>:<raft-port> for every replica.
*/}}
{{- define "rauthy.hqlNodes" -}}
{{- $replicas := int .Values.replicas -}}
{{- $headless := include "rauthy.headlessName" . -}}
{{- $fullname := include "rauthy.fullname" . -}}
{{- $nodes := list -}}
{{- range $i, $_ := until $replicas -}}
  {{- $nodeId := add1 $i -}}
  {{- $nodes = append $nodes (printf "%d %s-%d.%s:8100 %s-%d.%s:8200" $nodeId $fullname $i $headless $fullname $i $headless) -}}
{{- end -}}
{{ join ", " $nodes }}
{{- end -}}

{{/*
Strip a trailing /auth/v1 (or /auth/v1/) from the issuer URL to produce the
bare public URL that Rauthy expects in RAUTHY_PUB_URL.
*/}}
{{- define "rauthy.pubUrl" -}}
{{- .Values.oidc.issuer | trimSuffix "/auth/v1/" | trimSuffix "/auth/v1" | trimPrefix "https://" | trimPrefix "http://" -}}
{{- end -}}
