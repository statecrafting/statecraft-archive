// Lightweight mock for `encore.dev/pubsub` when running vitest outside the
// Encore runtime. Tests that want to assert PubSub wiring should use
// `vi.mock` to override specific collaborators; importing `Topic` /
// `Subscription` at module load no longer detonates the Encore native
// runtime requirement.

type Handler<T> = (event: T) => Promise<void> | void;

export class Topic<T> {
  constructor(public readonly name: string, _opts?: unknown) {}
  async publish(_event: T): Promise<{ id: string }> {
    return { id: `mock-${this.name}` };
  }
}

export class Subscription<T> {
  constructor(
    public readonly topic: Topic<T>,
    public readonly name: string,
    _cfg: { handler: Handler<T> },
  ) {
    // Handler is intentionally not invoked in the mock — integration tests
    // exercise it by calling module-level exports directly.
  }
}
