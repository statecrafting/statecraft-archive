-- Backfill: reassign legacy agent_policies rows stranded on the 'default'
-- org_id sentinel to the real organization.
--
-- Context: the security hardening in #494 made every agent-policy read and
-- write org-scoped by the caller's real org UUID (api/agents/agents.ts:
-- isAgentAuthorized now requires a UUID orgId; listAgentPolicies /
-- upsertAgentPolicy / deleteAgentPolicy all filter by auth.orgId). Rows
-- created before that cutover carry org_id = 'default' (the column default),
-- which no UUID-scoped query can ever match. Such rows are invisible to the
-- admin CRUD and, worse, a block policy stranded on 'default' is no longer
-- enforced for any real org. This migration un-strands them.
--
-- Safety: agent_policies has UNIQUE (org_id, slug), so a blind reassignment
-- could collide with a policy the real org already governs. We only act when
-- exactly ONE organization exists (the single-tenant deployment this platform
-- runs today); with zero or multiple orgs the correct target is absent or
-- ambiguous and we leave the 'default' rows untouched for explicit operator
-- resolution rather than guess. The reassignment is behaviourally
-- conservative: the app already ignores 'default' rows, so nothing that was
-- being enforced changes meaning; policies merely become visible/enforceable
-- under the real org that owns them.

DO $$
DECLARE
  org_count integer;
  target_org text;
BEGIN
  SELECT count(*) INTO org_count FROM public.organizations;

  IF org_count = 1 THEN
    SELECT id::text INTO target_org FROM public.organizations LIMIT 1;

    -- 1. Drop legacy 'default' rows whose slug the real org already governs.
    --    The real-org row is the authoritative policy and the only one the
    --    app reads; the 'default' duplicate is dead data. Removing it lets
    --    the reassignment in step 2 satisfy UNIQUE (org_id, slug). This
    --    deletes only unread duplicates, so it is behaviour-neutral.
    DELETE FROM public.agent_policies d
    WHERE d.org_id = 'default'
      AND EXISTS (
        SELECT 1
        FROM public.agent_policies r
        WHERE r.org_id = target_org
          AND r.slug = d.slug
      );

    -- 2. Reassign the remaining (now non-conflicting) legacy rows to the
    --    real org so they are enforced and visible again.
    UPDATE public.agent_policies
    SET org_id = target_org,
        updated_at = now()
    WHERE org_id = 'default';

    RAISE NOTICE 'agent_policies: backfilled stranded ''default'' rows to org %', target_org;
  ELSE
    RAISE NOTICE 'agent_policies: % organization(s) present; leaving ''default'' rows untouched (target absent or ambiguous)', org_count;
  END IF;
END $$;
