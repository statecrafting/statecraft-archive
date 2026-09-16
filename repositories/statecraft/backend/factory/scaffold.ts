/**
 * Run the template's scaffold verb (spec 005 §3 step 2; enrahitu spec 014).
 *
 * `node scripts/stamp.mjs --app-name X --org Y [--frontend F] [--cert PATH]
 * --stamped-from SHA`, executed inside the exported workdir. `--stamped-from`
 * is passed explicitly because the git-archive export has no .git for the
 * script's own rev-parse fallback. A non-zero exit rejects (execFile throws),
 * carrying stamp.mjs's stderr up to the pipeline's failure handler.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface ScaffoldInput {
  workdir: string;
  appName: string;
  org: string;
  frontend?: string;
  certPath?: string;
  stampedFrom: string;
}

export async function runScaffold(input: ScaffoldInput): Promise<string> {
  const args = [
    "scripts/stamp.mjs",
    "--app-name",
    input.appName,
    "--org",
    input.org,
    "--stamped-from",
    input.stampedFrom,
  ];
  if (input.frontend) args.push("--frontend", input.frontend);
  if (input.certPath) args.push("--cert", input.certPath);

  const res = await exec(process.execPath, args, {
    cwd: input.workdir,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return res.stdout;
}
