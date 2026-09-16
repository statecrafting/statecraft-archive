-- =====================================================================
-- Consolidated baseline schema (migration 1).
--
-- This single baseline replaces the prior 1..53 incremental migrations.
-- It was generated mechanically: all 53 historical migrations were applied
-- to a fresh Postgres, then pg_dump --schema-only captured the exact net
-- end-state (tables/columns dropped by later migrations are absent by
-- construction). The two required seeds (system user, default org) are
-- appended at the end.
--
-- The pg_dump session-SET preamble was stripped for cross-version portability
-- (pg_dump 18 emits SET transaction_timeout, a Postgres 17+ only parameter;
-- all DDL below is public.-qualified, so the session SETs were cosmetic).
--
-- Legacy artifacts purged by this consolidation:
--   * the aim-vue-node / goa-software-factory backfill seeds (retired specs
--     140/141) only ran per existing org/substrate row, so they produce
--     nothing on a fresh DB and are not reproduced here;
--   * the legacy-mixed / legacy-template-mixed source_id naming is replaced
--     at the application layer by the factory / template source_ids.
--
-- Safe because the deployed instance is rebuilt from scratch via oap-bootstrap
-- (no existing migration ledger to preserve). scripts/migrate.mjs creates the
-- schema_migrations ledger itself, so it is intentionally excluded here.
--
-- FIPS note: contains no md5() (the Hetzner Postgres runs FIPS-mode OpenSSL).
-- =====================================================================

--
-- PostgreSQL database dump
--




--
-- Name: connector_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.connector_status AS ENUM (
    'active',
    'paused',
    'error',
    'disabled'
);


--
-- Name: connector_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.connector_type AS ENUM (
    'upload',
    'sharepoint',
    's3',
    'azure-blob',
    'gcs'
);


--
-- Name: environment_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.environment_kind AS ENUM (
    'preview',
    'development',
    'staging',
    'production'
);


--
-- Name: factory_pipeline_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.factory_pipeline_status AS ENUM (
    'initialized',
    'running',
    'paused',
    'completed',
    'failed',
    'cancelled'
);


--
-- Name: factory_scaffold_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.factory_scaffold_category AS ENUM (
    'data',
    'api',
    'ui',
    'configure',
    'trim',
    'validate'
);


--
-- Name: factory_scaffold_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.factory_scaffold_status AS ENUM (
    'pending',
    'in_progress',
    'completed',
    'failed'
);


--
-- Name: factory_stage_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.factory_stage_status AS ENUM (
    'pending',
    'in_progress',
    'completed',
    'confirmed',
    'rejected'
);


--
-- Name: factory_sync_run_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.factory_sync_run_status AS ENUM (
    'pending',
    'running',
    'ok',
    'failed'
);


--
-- Name: installation_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.installation_state AS ENUM (
    'active',
    'suspended',
    'deleted'
);


--
-- Name: knowledge_extraction_run_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.knowledge_extraction_run_status AS ENUM (
    'pending',
    'running',
    'completed',
    'failed',
    'abandoned'
);


--
-- Name: knowledge_object_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.knowledge_object_state AS ENUM (
    'imported',
    'extracting',
    'extracted',
    'classified',
    'available',
    'unsupported_type'
);


--
-- Name: membership_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.membership_source AS ENUM (
    'github',
    'manual',
    'rauthy',
    'oidc'
);


--
-- Name: org_membership_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.org_membership_status AS ENUM (
    'active',
    'suspended',
    'removed'
);


--
-- Name: platform_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.platform_role AS ENUM (
    'owner',
    'admin',
    'member'
);


--
-- Name: project_clone_run_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.project_clone_run_status AS ENUM (
    'pending',
    'running',
    'ok',
    'failed'
);


--
-- Name: project_member_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.project_member_role AS ENUM (
    'viewer',
    'developer',
    'deployer',
    'admin'
);


--
-- Name: promotion_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.promotion_status AS ENUM (
    'promoted',
    'revoked'
);


--
-- Name: role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.role AS ENUM (
    'user',
    'admin'
);


--
-- Name: session_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.session_kind AS ENUM (
    'user',
    'admin'
);


--
-- Name: sync_run_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.sync_run_status AS ENUM (
    'running',
    'completed',
    'failed'
);


--
-- Name: target_scope; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.target_scope AS ENUM (
    'org',
    'project'
);




--
-- Name: agent_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text DEFAULT 'default'::text NOT NULL,
    slug text NOT NULL,
    blocked boolean DEFAULT false NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_user_id uuid NOT NULL,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    nhi_sub text,
    on_behalf_of text
);


--
-- Name: desktop_refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.desktop_refresh_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token_hash text NOT NULL,
    user_id uuid NOT NULL,
    org_id uuid NOT NULL,
    org_slug text DEFAULT ''::text NOT NULL,
    github_login text DEFAULT ''::text,
    platform_role text DEFAULT 'member'::text NOT NULL,
    rauthy_user_id text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    idp_provider text DEFAULT ''::text NOT NULL,
    idp_login text DEFAULT ''::text NOT NULL
);


--
-- Name: environment_access_gate_allowlist_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.environment_access_gate_allowlist_emails (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    environment_id uuid NOT NULL,
    kind text NOT NULL,
    value text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT environment_access_gate_allowlist_emails_kind_values CHECK ((kind = ANY (ARRAY['email'::text, 'domain'::text])))
);


--
-- Name: environment_access_gates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.environment_access_gates (
    environment_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    rauthy_client_ref text,
    login_method_magic_link boolean DEFAULT true NOT NULL,
    login_method_federated_provider text,
    login_method_federated_provider_client_ref text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    rauthy_client_secret text,
    cookie_secret text,
    tls_secret_name text DEFAULT 'tenants-wildcard-tls'::text NOT NULL,
    CONSTRAINT environment_access_gates_enabled_requires_ref CHECK (((enabled = false) OR (rauthy_client_ref IS NOT NULL))),
    CONSTRAINT environment_access_gates_enabled_requires_secrets CHECK (((enabled = false) OR ((rauthy_client_secret IS NOT NULL) AND (cookie_secret IS NOT NULL)))),
    CONSTRAINT environment_access_gates_federated_pair_consistent CHECK ((((login_method_federated_provider IS NULL) AND (login_method_federated_provider_client_ref IS NULL)) OR ((login_method_federated_provider IS NOT NULL) AND (login_method_federated_provider_client_ref IS NOT NULL)))),
    CONSTRAINT environment_access_gates_federated_provider_values CHECK (((login_method_federated_provider IS NULL) OR (login_method_federated_provider = ANY (ARRAY['google'::text, 'microsoft'::text, 'github'::text, 'generic_oidc'::text]))))
);


--
-- Name: environment_deployments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.environment_deployments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    environment_id uuid NOT NULL,
    project_id uuid NOT NULL,
    release_id text,
    release_sha text NOT NULL,
    artifact_ref text NOT NULL,
    variant text DEFAULT 'public'::text NOT NULL,
    status text NOT NULL,
    endpoints jsonb DEFAULT '[]'::jsonb NOT NULL,
    dispatched_by text NOT NULL,
    diagnostic text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT environment_deployments_status_chk CHECK ((status = ANY (ARRAY['REQUESTED'::text, 'PENDING'::text, 'ROLLED_OUT'::text, 'FAILED'::text, 'REQUEST_FAILED'::text, 'DESTROYED'::text]))),
    CONSTRAINT environment_deployments_variant_chk CHECK ((variant = ANY (ARRAY['root'::text, 'public'::text, 'internal'::text])))
);


--
-- Name: environments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.environments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL,
    kind public.environment_kind DEFAULT 'development'::public.environment_kind NOT NULL,
    k8s_namespace text,
    auto_deploy_branch text,
    requires_approval boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: factory_admissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.factory_admissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    origin text NOT NULL,
    status text NOT NULL,
    envelope_hash text,
    composed jsonb,
    violations jsonb DEFAULT '[]'::jsonb NOT NULL,
    scaffold_resolutions jsonb DEFAULT '{}'::jsonb NOT NULL,
    factory_sha text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    seal_jws text,
    sealed_at timestamp with time zone,
    CONSTRAINT factory_admissions_status_chk CHECK ((status = ANY (ARRAY['admitted'::text, 'refused'::text])))
);


--
-- Name: factory_artifact_substrate; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.factory_artifact_substrate (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    origin text NOT NULL,
    path text NOT NULL,
    kind text NOT NULL,
    bundle_id uuid,
    version integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    upstream_sha text,
    upstream_body text,
    user_body text,
    user_modified_at timestamp with time zone,
    user_modified_by uuid,
    effective_body text GENERATED ALWAYS AS (COALESCE(user_body, upstream_body)) STORED,
    content_hash text NOT NULL,
    frontmatter jsonb,
    conflict_state text,
    conflict_upstream_sha text,
    conflict_resolved_at timestamp with time zone,
    conflict_resolved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_body_verified boolean DEFAULT false NOT NULL,
    verified_by uuid,
    verified_at timestamp with time zone,
    CONSTRAINT factory_artifact_substrate_conflict_state_chk CHECK (((conflict_state IS NULL) OR (conflict_state = ANY (ARRAY['ok'::text, 'diverged'::text])))),
    CONSTRAINT factory_artifact_substrate_kind_chk CHECK ((kind = ANY (ARRAY['agent'::text, 'skill'::text, 'process-stage'::text, 'adapter-manifest'::text, 'contract-schema'::text, 'pattern'::text, 'page-type-reference'::text, 'sample-html'::text, 'reference-data'::text, 'invariant'::text, 'pipeline-orchestrator'::text, 'governance-envelope'::text]))),
    CONSTRAINT factory_artifact_substrate_status_chk CHECK ((status = ANY (ARRAY['active'::text, 'retired'::text])))
);


--
-- Name: factory_artifact_substrate_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.factory_artifact_substrate_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    artifact_id uuid NOT NULL,
    org_id uuid NOT NULL,
    action text NOT NULL,
    actor_user_id uuid,
    before jsonb,
    after jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT factory_artifact_substrate_audit_action_chk CHECK ((action = ANY (ARRAY['artifact.synced'::text, 'artifact.retired'::text, 'artifact.overridden'::text, 'artifact.override_cleared'::text, 'artifact.conflict_detected'::text, 'artifact.conflict_resolved'::text, 'artifact.forked'::text, 'artifact.override_gate_rejected'::text, 'artifact.override_verified'::text, 'artifact.scan_flagged'::text, 'artifact.scan_clean'::text, 'artifact.scan_skipped'::text, 'artifact.scan_failed'::text])))
);


--
-- Name: factory_artifacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.factory_artifacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pipeline_id uuid NOT NULL,
    stage_id character varying(50) NOT NULL,
    artifact_type character varying(100) NOT NULL,
    content_hash character varying(64) NOT NULL,
    storage_path text NOT NULL,
    size_bytes bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    project_id uuid,
    producer_agent character varying(100)
);


--
-- Name: factory_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.factory_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pipeline_id uuid NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
    event character varying(50) NOT NULL,
    actor character varying(255),
    stage_id character varying(50),
    feature_id character varying(100),
    details jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: factory_bindings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.factory_bindings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    artifact_id uuid NOT NULL,
    pinned_version integer NOT NULL,
    pinned_content_hash text NOT NULL,
    bound_by uuid NOT NULL,
    bound_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: factory_business_docs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.factory_business_docs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pipeline_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    storage_ref text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: factory_override_scan_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.factory_override_scan_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    artifact_id uuid NOT NULL,
    content_hash text NOT NULL,
    scanner_version text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    verdict text,
    rationale text,
    cost_usd numeric(10,6),
    attempts integer DEFAULT 0 NOT NULL,
    detail jsonb,
    queued_at timestamp with time zone DEFAULT now() NOT NULL,
    running_at timestamp with time zone,
    completed_at timestamp with time zone,
    last_event_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT factory_override_scan_runs_status_chk CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text, 'skipped'::text]))),
    CONSTRAINT factory_override_scan_runs_verdict_chk CHECK ((verdict = ANY (ARRAY['clean'::text, 'flagged'::text])))
);


--
-- Name: factory_pipelines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.factory_pipelines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    adapter_name character varying(100) NOT NULL,
    status public.factory_pipeline_status DEFAULT 'initialized'::public.factory_pipeline_status NOT NULL,
    policy_bundle_id uuid,
    build_spec_hash character varying(64),
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    previous_pipeline_id uuid,
    source text DEFAULT 'opc-direct'::text NOT NULL,
    CONSTRAINT factory_pipelines_source_check CHECK ((source = ANY (ARRAY['opc-direct'::text, 'statecraft'::text])))
);


--
-- Name: factory_policy_bundles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.factory_policy_bundles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    adapter_name character varying(100) NOT NULL,
    rules jsonb NOT NULL,
    compiled_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: factory_revocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.factory_revocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid,
    scope_kind text NOT NULL,
    key text NOT NULL,
    mode text NOT NULL,
    reason text NOT NULL,
    actor uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    lifted_at timestamp with time zone,
    lifted_by uuid,
    CONSTRAINT factory_revocations_mode_chk CHECK ((mode = ANY (ARRAY['revoked'::text, 'quarantined'::text]))),
    CONSTRAINT factory_revocations_scope_chk CHECK ((scope_kind = ANY (ARRAY['factory'::text, 'adapter'::text, 'agent'::text, 'content-hash'::text])))
);


--
-- Name: factory_run_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.factory_run_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    run_id uuid NOT NULL,
    project_id uuid,
    goal_id text NOT NULL,
    capsule_hash text NOT NULL,
    envelope_hash text NOT NULL,
    build_spec_hash text,
    seq integer NOT NULL,
    status text NOT NULL,
    refused_reason text,
    grant_jws text,
    kid text,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    CONSTRAINT factory_run_grants_status_chk CHECK ((status = ANY (ARRAY['issued'::text, 'refused'::text])))
);


--
-- Name: factory_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.factory_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    project_id uuid,
    triggered_by uuid NOT NULL,
    adapter_id text NOT NULL,
    process_id text NOT NULL,
    client_run_id text NOT NULL,
    status text NOT NULL,
    stage_progress jsonb DEFAULT '[]'::jsonb NOT NULL,
    token_spend jsonb,
    error text,
    source_shas jsonb NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    last_event_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    certificate_sha256 text,
    countersigned_at timestamp with time zone,
    CONSTRAINT factory_runs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'ok'::text, 'failed'::text, 'cancelled'::text])))
);


--
-- Name: factory_scaffold_features; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.factory_scaffold_features (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pipeline_id uuid NOT NULL,
    feature_id character varying(100) NOT NULL,
    category public.factory_scaffold_category NOT NULL,
    status public.factory_scaffold_status DEFAULT 'pending'::public.factory_scaffold_status NOT NULL,
    retry_count integer DEFAULT 0,
    last_error text,
    files_created text[],
    prompt_tokens integer DEFAULT 0,
    completion_tokens integer DEFAULT 0,
    started_at timestamp with time zone,
    completed_at timestamp with time zone
);


--
-- Name: factory_session_audit_seals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.factory_session_audit_seals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    session_id text NOT NULL,
    segment_id text NOT NULL,
    segment_head_hash text NOT NULL,
    segment_record_count integer NOT NULL,
    first_record_at timestamp with time zone,
    last_record_at timestamp with time zone,
    unanchored boolean DEFAULT false NOT NULL,
    countersign_jws text,
    countersign_kid text,
    countersigned_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: factory_stages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.factory_stages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pipeline_id uuid NOT NULL,
    stage_id character varying(50) NOT NULL,
    status public.factory_stage_status DEFAULT 'pending'::public.factory_stage_status NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    confirmed_by character varying(255),
    confirmed_at timestamp with time zone,
    rejected_by character varying(255),
    rejected_at timestamp with time zone,
    rejection_feedback text,
    prompt_tokens integer DEFAULT 0,
    completion_tokens integer DEFAULT 0,
    model character varying(50)
);


--
-- Name: factory_sync_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.factory_sync_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    status public.factory_sync_run_status DEFAULT 'pending'::public.factory_sync_run_status NOT NULL,
    triggered_by uuid NOT NULL,
    factory_sha text,
    template_sha text,
    counts jsonb,
    error text,
    queued_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone
);


--
-- Name: factory_upstream_pats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.factory_upstream_pats (
    org_id uuid NOT NULL,
    token_enc bytea NOT NULL,
    token_nonce bytea NOT NULL,
    token_prefix text NOT NULL,
    scopes text[] DEFAULT ARRAY[]::text[] NOT NULL,
    is_fine_grained boolean DEFAULT false NOT NULL,
    github_login text,
    last_used_at timestamp with time zone,
    last_checked_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: factory_upstreams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.factory_upstreams (
    org_id uuid NOT NULL,
    last_synced_at timestamp with time zone,
    last_sync_sha jsonb,
    last_sync_status text,
    last_sync_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_id text NOT NULL,
    role text NOT NULL,
    subpath text,
    repo_url text NOT NULL,
    ref text DEFAULT 'main'::text NOT NULL
);


--
-- Name: github_installations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.github_installations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    github_org_id bigint NOT NULL,
    github_org_login text NOT NULL,
    installation_id bigint NOT NULL,
    installation_state public.installation_state DEFAULT 'active'::public.installation_state NOT NULL,
    allowed_repos text,
    org_id uuid,
    installed_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: github_team_role_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.github_team_role_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    github_team_slug text NOT NULL,
    github_team_id bigint NOT NULL,
    target_scope public.target_scope NOT NULL,
    target_id uuid,
    role text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: knowledge_extraction_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_extraction_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    knowledge_object_id uuid NOT NULL,
    status public.knowledge_extraction_run_status DEFAULT 'pending'::public.knowledge_extraction_run_status NOT NULL,
    extractor_kind text,
    extractor_version text,
    agent_run jsonb,
    token_spend jsonb,
    cost_usd numeric(10,6),
    error jsonb,
    attempts integer DEFAULT 0 NOT NULL,
    queued_at timestamp with time zone DEFAULT now() NOT NULL,
    running_at timestamp with time zone,
    completed_at timestamp with time zone,
    duration_ms integer,
    project_id uuid NOT NULL
);


--
-- Name: knowledge_objects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_objects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    connector_id uuid,
    storage_key text NOT NULL,
    filename text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL,
    content_hash text NOT NULL,
    state public.knowledge_object_state DEFAULT 'imported'::public.knowledge_object_state NOT NULL,
    extraction_output jsonb,
    classification jsonb,
    provenance jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_extraction_error jsonb,
    project_id uuid NOT NULL
);


--
-- Name: oidc_group_role_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oidc_group_role_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    provider_id uuid NOT NULL,
    idp_group_id text NOT NULL,
    idp_group_name text,
    target_scope public.target_scope NOT NULL,
    target_id uuid,
    role text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: oidc_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oidc_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    provider_type text DEFAULT 'oidc'::text NOT NULL,
    issuer text NOT NULL,
    client_id text NOT NULL,
    client_secret_enc text NOT NULL,
    scopes text DEFAULT 'openid profile email'::text NOT NULL,
    claims_mapping jsonb DEFAULT '{}'::jsonb NOT NULL,
    email_domain text,
    auto_provision boolean DEFAULT true NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: org_halts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_halts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    scope text NOT NULL,
    scope_key text NOT NULL,
    state text DEFAULT 'halted'::text NOT NULL,
    reason text NOT NULL,
    pulled_by uuid NOT NULL,
    pulled_at timestamp with time zone DEFAULT now() NOT NULL,
    lifted_by uuid,
    lifted_at timestamp with time zone,
    acks jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT org_halts_scope_chk CHECK ((scope = ANY (ARRAY['org'::text, 'project'::text, 'agent-profile'::text]))),
    CONSTRAINT org_halts_state_chk CHECK ((state = ANY (ARRAY['halted'::text, 'reintegrating'::text, 'lifted'::text])))
);


--
-- Name: org_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    org_id uuid NOT NULL,
    source public.membership_source DEFAULT 'github'::public.membership_source NOT NULL,
    github_role text,
    platform_role public.platform_role DEFAULT 'member'::public.platform_role NOT NULL,
    status public.org_membership_status DEFAULT 'active'::public.org_membership_status NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    github_org_id bigint,
    github_org_login text,
    github_installation_id bigint
);


--
-- Name: project_artifacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_artifacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    release_sha text NOT NULL,
    variant text DEFAULT 'root'::text NOT NULL,
    image_ref text NOT NULL,
    workflow_run_id bigint,
    built_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_artifacts_variant_chk CHECK ((variant = ANY (ARRAY['root'::text, 'public'::text, 'internal'::text])))
);


--
-- Name: project_clone_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_clone_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_project_id uuid NOT NULL,
    org_id uuid NOT NULL,
    triggered_by uuid NOT NULL,
    status public.project_clone_run_status DEFAULT 'pending'::public.project_clone_run_status NOT NULL,
    requested_name text,
    requested_slug text,
    requested_repo_name text,
    final_name text,
    final_slug text,
    final_repo_name text,
    default_branch text,
    dest_repo_full_name text,
    project_id uuid,
    opc_deep_link text,
    raw_artifacts_copied integer,
    raw_artifacts_skipped integer,
    duration_ms integer,
    error text,
    queued_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    error_detail text
);


--
-- Name: project_github_pats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_github_pats (
    project_id uuid NOT NULL,
    token_enc bytea NOT NULL,
    token_nonce bytea NOT NULL,
    token_prefix text NOT NULL,
    scopes text[] DEFAULT ARRAY[]::text[] NOT NULL,
    is_fine_grained boolean DEFAULT false NOT NULL,
    github_login text,
    last_used_at timestamp with time zone,
    last_checked_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: project_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    enable_file_read boolean DEFAULT true NOT NULL,
    enable_file_write boolean DEFAULT true NOT NULL,
    enable_network boolean DEFAULT true NOT NULL,
    max_tier integer DEFAULT 2 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: project_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role public.project_member_role DEFAULT 'viewer'::public.project_member_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: project_repos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_repos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    github_org text NOT NULL,
    repo_name text NOT NULL,
    default_branch text DEFAULT 'main'::text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    github_install_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: project_spec_group_names; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_spec_group_names (
    project_id uuid NOT NULL,
    group_id text NOT NULL,
    display_name text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_spec_group_names_display_name_max_len CHECK ((length(display_name) <= 200)),
    CONSTRAINT project_spec_group_names_display_name_nonempty CHECK ((length(TRIM(BOTH FROM display_name)) > 0))
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    factory_adapter_id text,
    object_store_bucket text NOT NULL
);


--
-- Name: promotions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    pipeline_id uuid NOT NULL,
    workflow_id text NOT NULL,
    status public.promotion_status DEFAULT 'promoted'::public.promotion_status NOT NULL,
    promoted_by text,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    promoted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: scaffold_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scaffold_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    project_id uuid,
    factory_adapter_id text NOT NULL,
    requested_by uuid NOT NULL,
    variant text NOT NULL,
    profile_name text,
    status text DEFAULT 'pending'::text NOT NULL,
    step text,
    error_message text,
    github_org text,
    repo_name text,
    clone_url text,
    commit_sha text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    kind public.session_kind NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone
);


--
-- Name: source_connectors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.source_connectors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type public.connector_type NOT NULL,
    name text NOT NULL,
    config_encrypted jsonb,
    sync_schedule text,
    status public.connector_status DEFAULT 'active'::public.connector_status NOT NULL,
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    project_id uuid NOT NULL
);


--
-- Name: sync_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    connector_id uuid NOT NULL,
    status public.sync_run_status DEFAULT 'running'::public.sync_run_status NOT NULL,
    objects_created integer DEFAULT 0 NOT NULL,
    objects_updated integer DEFAULT 0 NOT NULL,
    objects_skipped integer DEFAULT 0 NOT NULL,
    error text,
    delta_token text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    project_id uuid NOT NULL
);


--
-- Name: user_github_pats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_github_pats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_enc bytea NOT NULL,
    token_nonce bytea NOT NULL,
    token_prefix text NOT NULL,
    scopes text[] DEFAULT ARRAY[]::text[] NOT NULL,
    is_fine_grained boolean DEFAULT false NOT NULL,
    last_used_at timestamp with time zone,
    last_checked_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone
);


--
-- Name: user_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_identities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider text DEFAULT 'github'::text NOT NULL,
    provider_user_id text NOT NULL,
    provider_login text NOT NULL,
    provider_email text,
    avatar_url text,
    access_token_enc text,
    refresh_token_enc text,
    token_expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    password_hash text,
    role public.role DEFAULT 'user'::public.role NOT NULL,
    disabled boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_login_at timestamp with time zone,
    github_user_id bigint,
    github_login text,
    avatar_url text,
    rauthy_user_id text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    idp_provider text,
    idp_subject text
);


--
-- Name: agent_policies agent_policies_org_id_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_policies
    ADD CONSTRAINT agent_policies_org_id_slug_key UNIQUE (org_id, slug);


--
-- Name: agent_policies agent_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_policies
    ADD CONSTRAINT agent_policies_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: desktop_refresh_tokens desktop_refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.desktop_refresh_tokens
    ADD CONSTRAINT desktop_refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: desktop_refresh_tokens desktop_refresh_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.desktop_refresh_tokens
    ADD CONSTRAINT desktop_refresh_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: environment_access_gate_allowlist_emails environment_access_gate_allowlist_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_access_gate_allowlist_emails
    ADD CONSTRAINT environment_access_gate_allowlist_emails_pkey PRIMARY KEY (id);


--
-- Name: environment_access_gates environment_access_gates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_access_gates
    ADD CONSTRAINT environment_access_gates_pkey PRIMARY KEY (environment_id);


--
-- Name: environment_deployments environment_deployments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_deployments
    ADD CONSTRAINT environment_deployments_pkey PRIMARY KEY (id);


--
-- Name: environments environments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environments
    ADD CONSTRAINT environments_pkey PRIMARY KEY (id);


--
-- Name: environments environments_project_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environments
    ADD CONSTRAINT environments_project_id_name_key UNIQUE (project_id, name);


--
-- Name: factory_admissions factory_admissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_admissions
    ADD CONSTRAINT factory_admissions_pkey PRIMARY KEY (id);


--
-- Name: factory_artifact_substrate_audit factory_artifact_substrate_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_artifact_substrate_audit
    ADD CONSTRAINT factory_artifact_substrate_audit_pkey PRIMARY KEY (id);


--
-- Name: factory_artifact_substrate factory_artifact_substrate_org_id_origin_path_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_artifact_substrate
    ADD CONSTRAINT factory_artifact_substrate_org_id_origin_path_version_key UNIQUE (org_id, origin, path, version);


--
-- Name: factory_artifact_substrate factory_artifact_substrate_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_artifact_substrate
    ADD CONSTRAINT factory_artifact_substrate_pkey PRIMARY KEY (id);


--
-- Name: factory_artifacts factory_artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_artifacts
    ADD CONSTRAINT factory_artifacts_pkey PRIMARY KEY (id);


--
-- Name: factory_audit_log factory_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_audit_log
    ADD CONSTRAINT factory_audit_log_pkey PRIMARY KEY (id);


--
-- Name: factory_bindings factory_bindings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_bindings
    ADD CONSTRAINT factory_bindings_pkey PRIMARY KEY (id);


--
-- Name: factory_bindings factory_bindings_project_id_artifact_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_bindings
    ADD CONSTRAINT factory_bindings_project_id_artifact_id_key UNIQUE (project_id, artifact_id);


--
-- Name: factory_business_docs factory_business_docs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_business_docs
    ADD CONSTRAINT factory_business_docs_pkey PRIMARY KEY (id);


--
-- Name: factory_override_scan_runs factory_override_scan_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_override_scan_runs
    ADD CONSTRAINT factory_override_scan_runs_pkey PRIMARY KEY (id);


--
-- Name: factory_pipelines factory_pipelines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_pipelines
    ADD CONSTRAINT factory_pipelines_pkey PRIMARY KEY (id);


--
-- Name: factory_policy_bundles factory_policy_bundles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_policy_bundles
    ADD CONSTRAINT factory_policy_bundles_pkey PRIMARY KEY (id);


--
-- Name: factory_revocations factory_revocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_revocations
    ADD CONSTRAINT factory_revocations_pkey PRIMARY KEY (id);


--
-- Name: factory_run_grants factory_run_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_run_grants
    ADD CONSTRAINT factory_run_grants_pkey PRIMARY KEY (id);


--
-- Name: factory_runs factory_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_runs
    ADD CONSTRAINT factory_runs_pkey PRIMARY KEY (id);


--
-- Name: factory_scaffold_features factory_scaffold_features_pipeline_id_feature_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_scaffold_features
    ADD CONSTRAINT factory_scaffold_features_pipeline_id_feature_id_key UNIQUE (pipeline_id, feature_id);


--
-- Name: factory_scaffold_features factory_scaffold_features_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_scaffold_features
    ADD CONSTRAINT factory_scaffold_features_pkey PRIMARY KEY (id);


--
-- Name: factory_session_audit_seals factory_session_audit_seals_org_session_segment_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_session_audit_seals
    ADD CONSTRAINT factory_session_audit_seals_org_session_segment_uniq UNIQUE (org_id, session_id, segment_id);


--
-- Name: factory_session_audit_seals factory_session_audit_seals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_session_audit_seals
    ADD CONSTRAINT factory_session_audit_seals_pkey PRIMARY KEY (id);


--
-- Name: factory_stages factory_stages_pipeline_id_stage_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_stages
    ADD CONSTRAINT factory_stages_pipeline_id_stage_id_key UNIQUE (pipeline_id, stage_id);


--
-- Name: factory_stages factory_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_stages
    ADD CONSTRAINT factory_stages_pkey PRIMARY KEY (id);


--
-- Name: factory_sync_runs factory_sync_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_sync_runs
    ADD CONSTRAINT factory_sync_runs_pkey PRIMARY KEY (id);


--
-- Name: factory_upstream_pats factory_upstream_pats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_upstream_pats
    ADD CONSTRAINT factory_upstream_pats_pkey PRIMARY KEY (org_id);


--
-- Name: factory_upstreams factory_upstreams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_upstreams
    ADD CONSTRAINT factory_upstreams_pkey PRIMARY KEY (org_id, source_id);


--
-- Name: github_installations github_installations_github_org_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.github_installations
    ADD CONSTRAINT github_installations_github_org_id_key UNIQUE (github_org_id);


--
-- Name: github_installations github_installations_installation_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.github_installations
    ADD CONSTRAINT github_installations_installation_id_key UNIQUE (installation_id);


--
-- Name: github_installations github_installations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.github_installations
    ADD CONSTRAINT github_installations_pkey PRIMARY KEY (id);


--
-- Name: github_team_role_mappings github_team_role_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.github_team_role_mappings
    ADD CONSTRAINT github_team_role_mappings_pkey PRIMARY KEY (id);


--
-- Name: knowledge_extraction_runs knowledge_extraction_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_extraction_runs
    ADD CONSTRAINT knowledge_extraction_runs_pkey PRIMARY KEY (id);


--
-- Name: knowledge_objects knowledge_objects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_objects
    ADD CONSTRAINT knowledge_objects_pkey PRIMARY KEY (id);


--
-- Name: oidc_group_role_mappings oidc_group_role_mappings_org_id_provider_id_idp_group_id_ta_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oidc_group_role_mappings
    ADD CONSTRAINT oidc_group_role_mappings_org_id_provider_id_idp_group_id_ta_key UNIQUE (org_id, provider_id, idp_group_id, target_scope, target_id);


--
-- Name: oidc_group_role_mappings oidc_group_role_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oidc_group_role_mappings
    ADD CONSTRAINT oidc_group_role_mappings_pkey PRIMARY KEY (id);


--
-- Name: oidc_providers oidc_providers_org_id_issuer_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oidc_providers
    ADD CONSTRAINT oidc_providers_org_id_issuer_key UNIQUE (org_id, issuer);


--
-- Name: oidc_providers oidc_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oidc_providers
    ADD CONSTRAINT oidc_providers_pkey PRIMARY KEY (id);


--
-- Name: org_halts org_halts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_halts
    ADD CONSTRAINT org_halts_pkey PRIMARY KEY (id);


--
-- Name: org_memberships org_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_memberships
    ADD CONSTRAINT org_memberships_pkey PRIMARY KEY (id);


--
-- Name: org_memberships org_memberships_user_id_org_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_memberships
    ADD CONSTRAINT org_memberships_user_id_org_id_key UNIQUE (user_id, org_id);


--
-- Name: organizations organizations_github_org_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_github_org_id_key UNIQUE (github_org_id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_slug_key UNIQUE (slug);


--
-- Name: project_artifacts project_artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_artifacts
    ADD CONSTRAINT project_artifacts_pkey PRIMARY KEY (id);


--
-- Name: project_artifacts project_artifacts_project_sha_variant_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_artifacts
    ADD CONSTRAINT project_artifacts_project_sha_variant_uniq UNIQUE (project_id, release_sha, variant);


--
-- Name: project_clone_runs project_clone_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_clone_runs
    ADD CONSTRAINT project_clone_runs_pkey PRIMARY KEY (id);


--
-- Name: project_github_pats project_github_pats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_github_pats
    ADD CONSTRAINT project_github_pats_pkey PRIMARY KEY (project_id);


--
-- Name: project_grants project_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_grants
    ADD CONSTRAINT project_grants_pkey PRIMARY KEY (id);


--
-- Name: project_grants project_grants_user_id_project_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_grants
    ADD CONSTRAINT project_grants_user_id_project_id_key UNIQUE (user_id, project_id);


--
-- Name: project_members project_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_pkey PRIMARY KEY (id);


--
-- Name: project_members project_members_project_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_project_id_user_id_key UNIQUE (project_id, user_id);


--
-- Name: project_repos project_repos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_repos
    ADD CONSTRAINT project_repos_pkey PRIMARY KEY (id);



--
-- Name: project_spec_group_names project_spec_group_names_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_spec_group_names
    ADD CONSTRAINT project_spec_group_names_pkey PRIMARY KEY (project_id, group_id);


--
-- Name: projects projects_org_id_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_org_id_slug_key UNIQUE (org_id, slug);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: promotions promotions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_pkey PRIMARY KEY (id);


--
-- Name: scaffold_jobs scaffold_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scaffold_jobs
    ADD CONSTRAINT scaffold_jobs_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_token_hash_key UNIQUE (token_hash);


--
-- Name: source_connectors source_connectors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_connectors
    ADD CONSTRAINT source_connectors_pkey PRIMARY KEY (id);


--
-- Name: sync_runs sync_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_runs
    ADD CONSTRAINT sync_runs_pkey PRIMARY KEY (id);


--
-- Name: user_github_pats user_github_pats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_github_pats
    ADD CONSTRAINT user_github_pats_pkey PRIMARY KEY (id);


--
-- Name: user_identities user_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_pkey PRIMARY KEY (id);


--
-- Name: user_identities user_identities_provider_provider_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_provider_provider_user_id_key UNIQUE (provider, provider_user_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_github_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_github_user_id_key UNIQUE (github_user_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_rauthy_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_rauthy_user_id_key UNIQUE (rauthy_user_id);


--
-- Name: environment_access_gate_allowlist_emails_env_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX environment_access_gate_allowlist_emails_env_idx ON public.environment_access_gate_allowlist_emails USING btree (environment_id, kind);


--
-- Name: environment_access_gate_allowlist_emails_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX environment_access_gate_allowlist_emails_unique ON public.environment_access_gate_allowlist_emails USING btree (environment_id, kind, lower(value));


--
-- Name: factory_admissions_org_origin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX factory_admissions_org_origin_idx ON public.factory_admissions USING btree (org_id, origin, created_at DESC);


--
-- Name: factory_artifact_substrate_audit_artifact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX factory_artifact_substrate_audit_artifact_idx ON public.factory_artifact_substrate_audit USING btree (artifact_id);


--
-- Name: factory_artifact_substrate_audit_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX factory_artifact_substrate_audit_org_idx ON public.factory_artifact_substrate_audit USING btree (org_id, created_at DESC);


--
-- Name: factory_artifact_substrate_bundle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX factory_artifact_substrate_bundle_idx ON public.factory_artifact_substrate USING btree (bundle_id) WHERE (bundle_id IS NOT NULL);


--
-- Name: factory_artifact_substrate_conflict_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX factory_artifact_substrate_conflict_idx ON public.factory_artifact_substrate USING btree (org_id, conflict_state) WHERE (conflict_state = 'diverged'::text);


--
-- Name: factory_artifact_substrate_org_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX factory_artifact_substrate_org_kind_idx ON public.factory_artifact_substrate USING btree (org_id, kind);


--
-- Name: factory_artifact_substrate_org_origin_path_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX factory_artifact_substrate_org_origin_path_idx ON public.factory_artifact_substrate USING btree (org_id, origin, path);


--
-- Name: factory_bindings_artifact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX factory_bindings_artifact_idx ON public.factory_bindings USING btree (artifact_id);


--
-- Name: factory_bindings_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX factory_bindings_project_idx ON public.factory_bindings USING btree (project_id);


--
-- Name: factory_revocations_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX factory_revocations_lookup_idx ON public.factory_revocations USING btree (scope_kind, key) WHERE (lifted_at IS NULL);


--
-- Name: factory_run_grants_issued_seq_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX factory_run_grants_issued_seq_uq ON public.factory_run_grants USING btree (run_id, seq) WHERE (status = 'issued'::text);


--
-- Name: factory_run_grants_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX factory_run_grants_run_idx ON public.factory_run_grants USING btree (org_id, run_id, seq);


--
-- Name: factory_runs_org_client_run_id_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX factory_runs_org_client_run_id_uniq ON public.factory_runs USING btree (org_id, client_run_id);


--
-- Name: factory_runs_org_in_flight_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX factory_runs_org_in_flight_idx ON public.factory_runs USING btree (org_id) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));


--
-- Name: factory_runs_org_started_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX factory_runs_org_started_at_idx ON public.factory_runs USING btree (org_id, started_at DESC);


--
-- Name: idx_desktop_refresh_tokens_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_desktop_refresh_tokens_expires ON public.desktop_refresh_tokens USING btree (expires_at);


--
-- Name: idx_desktop_refresh_tokens_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_desktop_refresh_tokens_user ON public.desktop_refresh_tokens USING btree (user_id);


--
-- Name: idx_environment_deployments_env_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_environment_deployments_env_created ON public.environment_deployments USING btree (environment_id, created_at DESC);


--
-- Name: idx_environment_deployments_release_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_environment_deployments_release_id ON public.environment_deployments USING btree (release_id) WHERE (release_id IS NOT NULL);


--
-- Name: idx_factory_artifacts_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_factory_artifacts_hash ON public.factory_artifacts USING btree (content_hash);


--
-- Name: idx_factory_artifacts_pipeline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_factory_artifacts_pipeline ON public.factory_artifacts USING btree (pipeline_id, stage_id);


--
-- Name: idx_factory_artifacts_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_factory_artifacts_project ON public.factory_artifacts USING btree (project_id);


--
-- Name: idx_factory_artifacts_project_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_factory_artifacts_project_hash ON public.factory_artifacts USING btree (project_id, content_hash);


--
-- Name: idx_factory_audit_pipeline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_factory_audit_pipeline ON public.factory_audit_log USING btree (pipeline_id, "timestamp");


--
-- Name: idx_factory_business_docs_pipeline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_factory_business_docs_pipeline ON public.factory_business_docs USING btree (pipeline_id);


--
-- Name: idx_factory_pipelines_previous; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_factory_pipelines_previous ON public.factory_pipelines USING btree (previous_pipeline_id);


--
-- Name: idx_factory_pipelines_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_factory_pipelines_project ON public.factory_pipelines USING btree (project_id);


--
-- Name: idx_factory_policy_bundles_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_factory_policy_bundles_project ON public.factory_policy_bundles USING btree (project_id);


--
-- Name: idx_factory_scaffold_pipeline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_factory_scaffold_pipeline ON public.factory_scaffold_features USING btree (pipeline_id);


--
-- Name: idx_factory_stages_pipeline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_factory_stages_pipeline ON public.factory_stages USING btree (pipeline_id);


--
-- Name: idx_factory_sync_runs_org_queued; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_factory_sync_runs_org_queued ON public.factory_sync_runs USING btree (org_id, queued_at DESC);


--
-- Name: idx_knowledge_extraction_runs_object_queued; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_extraction_runs_object_queued ON public.knowledge_extraction_runs USING btree (knowledge_object_id, queued_at DESC);


--
-- Name: idx_knowledge_extraction_runs_project_completed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_extraction_runs_project_completed ON public.knowledge_extraction_runs USING btree (project_id, completed_at DESC) WHERE (completed_at IS NOT NULL);


--
-- Name: idx_knowledge_extraction_runs_project_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_extraction_runs_project_status ON public.knowledge_extraction_runs USING btree (project_id, status);


--
-- Name: idx_knowledge_objects_connector; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_objects_connector ON public.knowledge_objects USING btree (connector_id);


--
-- Name: idx_knowledge_objects_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_objects_project ON public.knowledge_objects USING btree (project_id);


--
-- Name: idx_knowledge_objects_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_objects_state ON public.knowledge_objects USING btree (project_id, state);


--
-- Name: idx_oidc_providers_email_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oidc_providers_email_domain ON public.oidc_providers USING btree (email_domain) WHERE ((email_domain IS NOT NULL) AND (status = 'active'::text));


--
-- Name: idx_org_halts_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_org_halts_active ON public.org_halts USING btree (org_id, scope, scope_key) WHERE (state <> 'lifted'::text);


--
-- Name: idx_override_scan_runs_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_override_scan_runs_dedupe ON public.factory_override_scan_runs USING btree (org_id, artifact_id, content_hash, scanner_version, queued_at);


--
-- Name: idx_override_scan_runs_org_completed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_override_scan_runs_org_completed ON public.factory_override_scan_runs USING btree (org_id, completed_at);


--
-- Name: idx_override_scan_runs_status_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_override_scan_runs_status_event ON public.factory_override_scan_runs USING btree (status, last_event_at);


--
-- Name: idx_project_artifacts_project_sha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_artifacts_project_sha ON public.project_artifacts USING btree (project_id, release_sha);


--
-- Name: idx_project_clone_runs_org_queued; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_clone_runs_org_queued ON public.project_clone_runs USING btree (org_id, queued_at DESC);


--
-- Name: idx_projects_factory_adapter_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_factory_adapter_id ON public.projects USING btree (factory_adapter_id);


--
-- Name: idx_promotions_pipeline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_promotions_pipeline ON public.promotions USING btree (pipeline_id);


--
-- Name: idx_promotions_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_promotions_project ON public.promotions USING btree (project_id);


--
-- Name: idx_scaffold_jobs_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scaffold_jobs_project ON public.scaffold_jobs USING btree (project_id);


--
-- Name: idx_source_connectors_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_source_connectors_project ON public.source_connectors USING btree (project_id);


--
-- Name: idx_sync_runs_connector; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_runs_connector ON public.sync_runs USING btree (connector_id);


--
-- Name: idx_sync_runs_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_runs_project ON public.sync_runs USING btree (project_id);


--
-- Name: idx_team_mappings_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_mappings_org ON public.github_team_role_mappings USING btree (org_id);


--
-- Name: idx_team_mappings_org_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_mappings_org_team ON public.github_team_role_mappings USING btree (org_id, github_team_slug);


--
-- Name: idx_team_mappings_org_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_team_mappings_org_unique ON public.github_team_role_mappings USING btree (org_id, github_team_slug, target_scope) WHERE (target_id IS NULL);


--
-- Name: idx_team_mappings_project_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_team_mappings_project_unique ON public.github_team_role_mappings USING btree (org_id, github_team_slug, target_scope, target_id) WHERE (target_id IS NOT NULL);


--
-- Name: idx_user_github_pats_active_one_per_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_user_github_pats_active_one_per_user ON public.user_github_pats USING btree (user_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_user_github_pats_last_checked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_github_pats_last_checked ON public.user_github_pats USING btree (last_checked_at) WHERE (revoked_at IS NULL);


--
-- Name: idx_user_github_pats_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_github_pats_user ON public.user_github_pats USING btree (user_id);


--
-- Name: project_repos_org_repo_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX project_repos_org_repo_uniq ON public.project_repos USING btree (github_org, repo_name);


--
-- Name: project_spec_group_names_by_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_spec_group_names_by_project ON public.project_spec_group_names USING btree (project_id);


--
-- Name: audit_log audit_log_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: desktop_refresh_tokens desktop_refresh_tokens_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.desktop_refresh_tokens
    ADD CONSTRAINT desktop_refresh_tokens_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: desktop_refresh_tokens desktop_refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.desktop_refresh_tokens
    ADD CONSTRAINT desktop_refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: environment_access_gate_allowlist_emails environment_access_gate_allowlist_emails_environment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_access_gate_allowlist_emails
    ADD CONSTRAINT environment_access_gate_allowlist_emails_environment_id_fkey FOREIGN KEY (environment_id) REFERENCES public.environments(id) ON DELETE CASCADE;


--
-- Name: environment_access_gates environment_access_gates_environment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_access_gates
    ADD CONSTRAINT environment_access_gates_environment_id_fkey FOREIGN KEY (environment_id) REFERENCES public.environments(id) ON DELETE CASCADE;


--
-- Name: environments environments_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environments
    ADD CONSTRAINT environments_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: factory_artifact_substrate factory_artifact_substrate_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_artifact_substrate
    ADD CONSTRAINT factory_artifact_substrate_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: factory_artifacts factory_artifacts_pipeline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_artifacts
    ADD CONSTRAINT factory_artifacts_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.factory_pipelines(id) ON DELETE CASCADE;


--
-- Name: factory_audit_log factory_audit_log_pipeline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_audit_log
    ADD CONSTRAINT factory_audit_log_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.factory_pipelines(id) ON DELETE CASCADE;


--
-- Name: factory_bindings factory_bindings_artifact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_bindings
    ADD CONSTRAINT factory_bindings_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.factory_artifact_substrate(id) ON DELETE RESTRICT;


--
-- Name: factory_bindings factory_bindings_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_bindings
    ADD CONSTRAINT factory_bindings_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: factory_business_docs factory_business_docs_pipeline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_business_docs
    ADD CONSTRAINT factory_business_docs_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.factory_pipelines(id) ON DELETE CASCADE;


--
-- Name: factory_pipelines factory_pipelines_previous_pipeline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_pipelines
    ADD CONSTRAINT factory_pipelines_previous_pipeline_id_fkey FOREIGN KEY (previous_pipeline_id) REFERENCES public.factory_pipelines(id);


--
-- Name: factory_pipelines factory_pipelines_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_pipelines
    ADD CONSTRAINT factory_pipelines_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: factory_policy_bundles factory_policy_bundles_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_policy_bundles
    ADD CONSTRAINT factory_policy_bundles_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: factory_runs factory_runs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_runs
    ADD CONSTRAINT factory_runs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: factory_runs factory_runs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_runs
    ADD CONSTRAINT factory_runs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: factory_runs factory_runs_triggered_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_runs
    ADD CONSTRAINT factory_runs_triggered_by_fkey FOREIGN KEY (triggered_by) REFERENCES public.users(id);


--
-- Name: factory_scaffold_features factory_scaffold_features_pipeline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_scaffold_features
    ADD CONSTRAINT factory_scaffold_features_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.factory_pipelines(id) ON DELETE CASCADE;


--
-- Name: factory_stages factory_stages_pipeline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_stages
    ADD CONSTRAINT factory_stages_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.factory_pipelines(id) ON DELETE CASCADE;


--
-- Name: factory_sync_runs factory_sync_runs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_sync_runs
    ADD CONSTRAINT factory_sync_runs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: factory_sync_runs factory_sync_runs_triggered_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_sync_runs
    ADD CONSTRAINT factory_sync_runs_triggered_by_fkey FOREIGN KEY (triggered_by) REFERENCES public.users(id);


--
-- Name: factory_upstream_pats factory_upstream_pats_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_upstream_pats
    ADD CONSTRAINT factory_upstream_pats_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: factory_upstream_pats factory_upstream_pats_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_upstream_pats
    ADD CONSTRAINT factory_upstream_pats_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: factory_upstreams factory_upstreams_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factory_upstreams
    ADD CONSTRAINT factory_upstreams_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: github_installations github_installations_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.github_installations
    ADD CONSTRAINT github_installations_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: github_team_role_mappings github_team_role_mappings_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.github_team_role_mappings
    ADD CONSTRAINT github_team_role_mappings_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: knowledge_extraction_runs knowledge_extraction_runs_knowledge_object_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_extraction_runs
    ADD CONSTRAINT knowledge_extraction_runs_knowledge_object_id_fkey FOREIGN KEY (knowledge_object_id) REFERENCES public.knowledge_objects(id) ON DELETE CASCADE;


--
-- Name: knowledge_extraction_runs knowledge_extraction_runs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_extraction_runs
    ADD CONSTRAINT knowledge_extraction_runs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: knowledge_objects knowledge_objects_connector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_objects
    ADD CONSTRAINT knowledge_objects_connector_id_fkey FOREIGN KEY (connector_id) REFERENCES public.source_connectors(id);


--
-- Name: knowledge_objects knowledge_objects_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_objects
    ADD CONSTRAINT knowledge_objects_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: oidc_group_role_mappings oidc_group_role_mappings_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oidc_group_role_mappings
    ADD CONSTRAINT oidc_group_role_mappings_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: oidc_group_role_mappings oidc_group_role_mappings_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oidc_group_role_mappings
    ADD CONSTRAINT oidc_group_role_mappings_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.oidc_providers(id) ON DELETE CASCADE;


--
-- Name: oidc_providers oidc_providers_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oidc_providers
    ADD CONSTRAINT oidc_providers_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: org_memberships org_memberships_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_memberships
    ADD CONSTRAINT org_memberships_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: org_memberships org_memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_memberships
    ADD CONSTRAINT org_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: organizations organizations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: project_clone_runs project_clone_runs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_clone_runs
    ADD CONSTRAINT project_clone_runs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: project_clone_runs project_clone_runs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_clone_runs
    ADD CONSTRAINT project_clone_runs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: project_clone_runs project_clone_runs_source_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_clone_runs
    ADD CONSTRAINT project_clone_runs_source_project_id_fkey FOREIGN KEY (source_project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_clone_runs project_clone_runs_triggered_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_clone_runs
    ADD CONSTRAINT project_clone_runs_triggered_by_fkey FOREIGN KEY (triggered_by) REFERENCES public.users(id);


--
-- Name: project_github_pats project_github_pats_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_github_pats
    ADD CONSTRAINT project_github_pats_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: project_github_pats project_github_pats_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_github_pats
    ADD CONSTRAINT project_github_pats_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_grants project_grants_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_grants
    ADD CONSTRAINT project_grants_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_grants project_grants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_grants
    ADD CONSTRAINT project_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: project_members project_members_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_members project_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: project_repos project_repos_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_repos
    ADD CONSTRAINT project_repos_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_spec_group_names project_spec_group_names_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_spec_group_names
    ADD CONSTRAINT project_spec_group_names_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: projects projects_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: projects projects_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: scaffold_jobs scaffold_jobs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scaffold_jobs
    ADD CONSTRAINT scaffold_jobs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: scaffold_jobs scaffold_jobs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scaffold_jobs
    ADD CONSTRAINT scaffold_jobs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: scaffold_jobs scaffold_jobs_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scaffold_jobs
    ADD CONSTRAINT scaffold_jobs_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id);


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: source_connectors source_connectors_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_connectors
    ADD CONSTRAINT source_connectors_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: sync_runs sync_runs_connector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_runs
    ADD CONSTRAINT sync_runs_connector_id_fkey FOREIGN KEY (connector_id) REFERENCES public.source_connectors(id) ON DELETE CASCADE;


--
-- Name: sync_runs sync_runs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_runs
    ADD CONSTRAINT sync_runs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: user_github_pats user_github_pats_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_github_pats
    ADD CONSTRAINT user_github_pats_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_identities user_identities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--



--
-- Required seeds (system user for M2M audit FK; default org anchoring slug 'default').
--
INSERT INTO public.users (id, name, email, password_hash, role)
VALUES ('00000000-0000-0000-0000-000000000000','system','system@opc.local','!disabled','admin')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organizations (id, name, slug, created_by)
VALUES ('00000000-0000-0000-0000-000000000001','Default','default','00000000-0000-0000-0000-000000000000')
ON CONFLICT (id) DO NOTHING;
