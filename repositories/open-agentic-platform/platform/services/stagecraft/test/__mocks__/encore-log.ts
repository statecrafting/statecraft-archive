// Lightweight mock for `encore.dev/log` when running vitest outside the
// Encore runtime. Matches the shape used in the codebase: `log.info(...)`,
// `log.warn(...)`, `log.error(...)`, `log.debug(...)`.
const noop = (..._args: unknown[]) => {};
const log = { trace: noop, debug: noop, info: noop, warn: noop, error: noop };
export default log;
