export class MutationQueue {
  private tail: Promise<unknown> = Promise.resolve();
  active = false;
  run<T>(action: () => Promise<T>): Promise<T> {
    const execute = async () => {
      this.active = true;
      try {
        return await action();
      } finally {
        this.active = false;
      }
    };
    const result = this.tail.then(execute, execute);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
