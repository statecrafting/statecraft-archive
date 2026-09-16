/**
 * Factory Adapters browser (spec 199 thin-consumer cutover).
 *
 * Adapters self-declare via their manifest (`adapter.name` /
 * `adapter.version` — spec 199 FR-002); the drawer shows the manifest
 * JSON, source sha, and synced_at timestamp. Read-only — edits happen
 * upstream and land via the sync worker. When the factory is not
 * admitted, the empty state says WHY (spec 198 FR-001 / 199 FR-006).
 */

import { useLoaderData } from "react-router";
import { requireUser } from "../lib/auth.server";
import {
  getFactoryAdapter,
  listFactoryAdapters,
  type FactoryAdmissionWire,
  type FactoryAdapterDetail,
  type FactoryResourceSummary,
} from "../lib/factory-api.server";
import {
  FactoryBrowser,
  type FactoryBrowserDetail,
} from "../components/factory-browser";

type LoaderData = {
  adapters: FactoryResourceSummary[];
  admission: FactoryAdmissionWire;
  selectedName: string | null;
  selected: FactoryBrowserDetail | null;
  loadError: string | null;
};

export async function loader({
  request,
}: {
  request: Request;
}): Promise<LoaderData> {
  await requireUser(request);
  const url = new URL(request.url);
  const selectedName = url.searchParams.get("name");

  const { adapters, admission } = await listFactoryAdapters(request);

  let selected: FactoryBrowserDetail | null = null;
  let loadError: string | null = null;
  if (selectedName) {
    try {
      const detail: FactoryAdapterDetail = await getFactoryAdapter(
        request,
        selectedName
      );
      selected = {
        name: detail.name,
        version: detail.version,
        sourceSha: detail.sourceSha,
        syncedAt: detail.syncedAt,
        body: detail.manifest,
      };
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  }

  return { adapters, admission, selectedName, selected, loadError };
}

export default function FactoryAdapters() {
  const { adapters, admission, selected, selectedName, loadError } =
    useLoaderData<typeof loader>();

  return (
    <FactoryBrowser
      items={adapters}
      selected={selected}
      selectedName={selectedName}
      resourceKind="adapter"
      bodyLabel="Manifest"
      loadError={loadError}
      emptyCopy={{
        title: "No adapters yet",
        description:
          admission.status === "admitted"
            ? "Adapters appear here after the first successful sync of the factory upstreams."
            : `Factory not admitted — content is not served (spec 198): ${admission.reason ?? "no conformant governance envelope filed"}`,
      }}
    />
  );
}
