/**
 * Typed facade over the fleet-native napi addon (spec 006 §1/§2; the addon
 * itself is statecrafting spec 006).
 *
 * The addon's surface is plain-JSON-in / plain-JSON-out (`Promise<string>`); this
 * module owns the TypeScript types and the JSON boundary so the rest of the
 * service works in typed objects. The addon resolves the kubeconfig Rust-side
 * (`FLEET_KUBECONFIG_PATH`, else in-cluster / `~/.kube/config`); this layer never
 * opens the kubeconfig file.
 */
import fleetNative from "@statecrafting/fleet-native";

/** The desired placement for one app. `namespace` is `t-<tenantId>`. */
export interface DeploySpec {
  name: string;
  namespace: string;
  image: string;
  host: string;
  volumeSizeGi?: number;
  port?: number;
  tlsIssuer?: string;
  tlsSecretName?: string | null;
  imagePullSecret?: string | null;
}

/** The observed state of a placed app. `status`: running | updating | failed. */
export interface AppStatus {
  name: string;
  namespace: string;
  status: string;
  host: string;
  image: string;
  availableReplicas: number;
  message?: string;
}

/** Restic + Hetzner Object Storage target for a backup (spec 006 §3). */
export interface BackupTarget {
  repositoryBase: string;
  password: string;
  accessKeyId: string;
  secretAccessKey: string;
  resticImage?: string;
}

/** The recorded artifact location after a backup, written onto FleetOp. */
export interface BackupResult {
  repository: string;
  tag: string;
  jobName: string;
  snapshotId?: string;
}

export interface RemoveResult {
  name: string;
  namespace: string;
  removed: boolean;
}

interface FleetNative {
  placeApp(specJson: string): Promise<string>;
  appStatus(name: string, namespace: string): Promise<string>;
  updateApp(specJson: string): Promise<string>;
  backupApp(name: string, namespace: string, targetJson: string): Promise<string>;
  removeApp(name: string, namespace: string): Promise<string>;
}

const native = fleetNative as unknown as FleetNative;

export async function placeApp(spec: DeploySpec): Promise<AppStatus> {
  return JSON.parse(await native.placeApp(JSON.stringify(spec))) as AppStatus;
}

export async function appStatus(name: string, namespace: string): Promise<AppStatus> {
  return JSON.parse(await native.appStatus(name, namespace)) as AppStatus;
}

export async function updateApp(spec: DeploySpec): Promise<AppStatus> {
  return JSON.parse(await native.updateApp(JSON.stringify(spec))) as AppStatus;
}

export async function backupApp(
  name: string,
  namespace: string,
  target: BackupTarget,
): Promise<BackupResult> {
  return JSON.parse(
    await native.backupApp(name, namespace, JSON.stringify(target)),
  ) as BackupResult;
}

export async function removeApp(name: string, namespace: string): Promise<RemoveResult> {
  return JSON.parse(await native.removeApp(name, namespace)) as RemoveResult;
}
