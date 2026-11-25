import type { NumericValue } from "../types.js";

/** Positional window with most-recent ties; null observations never stretch its span. */
export class ExtremeIndexWindow {
  private entries: { index: number; value: number }[] = [];
  private head = 0;
  constructor(private readonly maximum: boolean) {}
  push(index: number, value: NumericValue, length: number) {
    while (this.head < this.entries.length && this.entries[this.head]!.index <= index - length)
      this.head++;
    if (value !== null) {
      while (
        this.entries.length > this.head &&
        (this.maximum ? this.entries.at(-1)!.value <= value : this.entries.at(-1)!.value >= value)
      )
        this.entries.pop();
      this.entries.push({ index, value });
    }
    if (this.head > 1024 && this.head * 2 > this.entries.length) {
      this.entries.splice(0, this.head);
      this.head = 0;
    }
    return this.entries[this.head] ?? null;
  }
}
