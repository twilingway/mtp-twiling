export interface WelcomeState {
  ready: boolean;
  hidden: boolean;
  saving: boolean;
  error?: "load" | "save" | undefined;
}
export class WelcomeModel {
  private state: WelcomeState = { ready: false, hidden: false, saving: false };
  private readonly listeners = new Set<() => void>();
  constructor(
    private readonly store: { load(): Promise<boolean>; save(hidden: boolean): Promise<void> }
  ) {}
  getSnapshot = (): WelcomeState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<WelcomeState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  async load(): Promise<void> {
    try {
      this.update({ hidden: await this.store.load(), ready: true, error: undefined });
    } catch {
      this.update({ hidden: false, ready: true, error: "load" });
    }
  }
  async finish(hidden: boolean): Promise<boolean> {
    if (this.state.saving) return false;
    if (hidden === this.state.hidden) return true;
    this.update({ saving: true, error: undefined });
    try {
      await this.store.save(hidden);
      this.update({ hidden, saving: false });
      return true;
    } catch {
      this.update({ saving: false, error: "save" });
      return false;
    }
  }
}
