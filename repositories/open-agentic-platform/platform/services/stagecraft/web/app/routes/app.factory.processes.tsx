/**
 * Factory Processes browser (spec 199 thin-consumer cutover).
 *
 * The org's process — the identity its governance envelope declares
 * (spec 198) — with a detail drawer showing the opaque-by-kind definition
 * JSON, source sha, and synced_at timestamp. When the factory is not
 * admitted, the empty state says WHY (spec 199 FR-006).
 */

import { useLoaderData } from "react-router";
import { requireUser } from "../lib/auth.server";
import {
  getFactoryProcess,
  listFactoryProcesses,
  type FactoryAdmissionWire,
  type FactoryProcessDetail,
  type FactoryResourceSummary,
} from "../lib/factory-api.server";
import {
  FactoryBrowser,
  type FactoryBrowserDetail,
} from "../components/factory-browser";

type LoaderData = {
  processes: FactoryResourceSummary[];
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

  const { processes, admission } = await listFactoryProcesses(request);

  let selected: FactoryBrowserDetail | null = null;
  let loadError: string | null = null;
  if (selectedName) {
    try {
      const detail: FactoryProcessDetail = await getFactoryProcess(
        request,
        selectedName
      );
      selected = {
        name: detail.name,
        version: detail.version,
        sourceSha: detail.sourceSha,
        syncedAt: detail.syncedAt,
        body: detail.definition,
      };
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  }

  return { processes, admission, selectedName, selected, loadError };
}

export default function FactoryProcesses() {
  const { processes, admission, selected, selectedName, loadError } =
    useLoaderData<typeof loader>();

  return (
    <FactoryBrowser
      items={processes}
      selected={selected}
      selectedName={selectedName}
      resourceKind="process"
      bodyLabel="Definition"
      loadError={loadError}
      emptyCopy={{
        title: "No processes yet",
        description:
          admission.status === "admitted"
            ? "Processes appear here after the first successful sync of the factory upstreams."
            : `Factory not admitted — content is not served (spec 198): ${admission.reason ?? "no conformant governance envelope filed"}`,
      }}
    />
  );
}
