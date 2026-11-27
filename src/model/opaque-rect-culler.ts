const MAX_PIXELS = 4 * 1024 * 1024;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_RECORDS = 1_000_000;
const MAX_COLUMN_WORDS = 8 * 1024 * 1024;
const MAX_WIDTH = 64;
const STYLE_COUNT = 256;
const COMMAND_BYTES = 4 * Int32Array.BYTES_PER_ELEMENT + Uint8Array.BYTES_PER_ELEMENT;
const FRAGMENT_BYTES = 4 * Int32Array.BYTES_PER_ELEMENT;

interface PaintTarget {
  setStyle(id: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
}

export class OpaqueRectUnsupportedError extends Error {
  constructor(message = "Unsupported opaque rectangle frame") {
    super(message);
    this.name = "OpaqueRectUnsupportedError";
  }
}

/** Records opaque rectangles; prepares disjoint last-painter pixels before any target write. */
export class OpaqueRectCuller {
  private readonly words: number;
  private coverage = new Uint32Array(0);
  private commands = new Int32Array(0);
  private commandStyles = new Uint8Array(0);
  private fragments = new Int32Array(0);
  private links = new Int32Array(0);
  private heads = new Int32Array(0);
  private tails = new Int32Array(0);
  private commandsUsed = 0;
  private fragmentsUsed = 0;
  private columnWords = 0;
  private ready = false;
  private failed = false;
  private disposed = false;

  constructor(
    private readonly width: number,
    private readonly height: number
  ) {
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      width * height > MAX_PIXELS
    ) {
      throw new OpaqueRectUnsupportedError("Unsupported bitmap size");
    }
    this.words = Math.ceil(height / 32);
    this.reserve(width * this.words * Uint32Array.BYTES_PER_ELEMENT + STYLE_COUNT * 8);
    this.allocate(() => {
      this.coverage = new Uint32Array(width * this.words);
      this.heads = new Int32Array(STYLE_COUNT);
      this.tails = new Int32Array(STYLE_COUNT);
    });
  }

  get memoryBytes(): number {
    return (
      this.coverage.byteLength +
      this.commands.byteLength +
      this.commandStyles.byteLength +
      this.fragments.byteLength +
      this.links.byteLength +
      this.heads.byteLength +
      this.tails.byteLength
    );
  }

  get commandCount(): number {
    return this.commandsUsed;
  }

  get fragmentCount(): number {
    return this.fragmentsUsed;
  }

  begin(): void {
    this.assertActive();
    this.commandsUsed = 0;
    this.fragmentsUsed = 0;
    this.columnWords = 0;
    this.failed = false;
    this.ready = false;
  }

  addRect(x: number, y: number, width: number, height: number, styleId: number): void {
    this.assertRecording();
    if (
      !Number.isSafeInteger(x) ||
      !Number.isSafeInteger(y) ||
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      !Number.isSafeInteger(x + width) ||
      !Number.isSafeInteger(y + height) ||
      !Number.isInteger(styleId) ||
      styleId < 0 ||
      styleId >= STYLE_COUNT
    ) {
      this.reject("Unsupported integer geometry or style");
    }
    if (styleId === 0 || width === 0 || height === 0) return;
    const left = Math.max(0, Math.min(x, x + width));
    const top = Math.max(0, Math.min(y, y + height));
    const right = Math.min(this.width, Math.max(x, x + width));
    const bottom = Math.min(this.height, Math.max(y, y + height));
    if (left >= right || top >= bottom) return;
    if (right - left > MAX_WIDTH) this.reject("Unsupported clipped rectangle width");
    // Bound covered-word scans as well as output size: heavy overdraw can emit only one fragment.
    // Exact native fallback is preferable to spending unbounded CPU rejecting invisible pixels.
    const columnWords =
      this.columnWords + (right - left) * (((bottom - 1) >>> 5) - (top >>> 5) + 1);
    if (columnWords > MAX_COLUMN_WORDS) this.reject("Rectangle coverage work budget exceeded");
    if (this.commandsUsed === this.commandStyles.length) this.growCommands();
    const index = this.commandsUsed++;
    const offset = index * 4;
    this.commands[offset] = left;
    this.commands[offset + 1] = top;
    this.commands[offset + 2] = right;
    this.commands[offset + 3] = bottom;
    this.commandStyles[index] = styleId;
    this.columnWords = columnWords;
  }

  cull(): void {
    this.assertActive();
    if (this.failed) this.reject("Frame has already failed");
    if (this.ready) return;
    this.coverage.fill(0);
    this.heads.fill(-1);
    this.tails.fill(-1);
    this.fragmentsUsed = 0;
    for (let index = this.commandsUsed - 1; index >= 0; index--) {
      const offset = index * 4;
      const left = this.commands[offset]!;
      const top = this.commands[offset + 1]!;
      const right = this.commands[offset + 2]!;
      const bottom = this.commands[offset + 3]!;
      const style = this.commandStyles[index]!;
      for (let x = left; x < right; x++) this.cullColumn(x, top, bottom, style);
    }
    this.ready = true;
  }

  paint(target: PaintTarget): void {
    this.assertActive();
    if (this.failed || !this.ready) this.reject("Frame must be successfully culled before paint");
    // Opaque fragments are disjoint, so grouping styles cannot change their winning pixels.
    for (let style = 1; style < STYLE_COUNT; style++) {
      let index = this.heads[style]!;
      if (index === -1) continue;
      target.setStyle(style);
      for (; index !== -1; index = this.links[index]!) {
        const offset = index * 3;
        target.fillRect(
          this.fragments[offset]!,
          this.fragments[offset + 1]!,
          1,
          this.fragments[offset + 2]!
        );
      }
    }
  }

  dispose(): void {
    this.coverage = new Uint32Array(0);
    this.commands = new Int32Array(0);
    this.commandStyles = new Uint8Array(0);
    this.fragments = new Int32Array(0);
    this.links = new Int32Array(0);
    this.heads = new Int32Array(0);
    this.tails = new Int32Array(0);
    this.commandsUsed = 0;
    this.fragmentsUsed = 0;
    this.ready = false;
    this.disposed = true;
    this.columnWords = 0;
  }

  private cullColumn(x: number, top: number, bottom: number, style: number): void {
    const firstWord = top >>> 5;
    const lastWord = (bottom - 1) >>> 5;
    let runTop = -1;
    let runEnd = -1;
    for (let word = firstWord; word <= lastWord; word++) {
      const firstBit = word === firstWord ? top & 31 : 0;
      const lastBit = word === lastWord ? (bottom - 1) & 31 : 31;
      const mask = ((0xffffffff << firstBit) & (0xffffffff >>> (31 - lastBit))) >>> 0;
      const address = x * this.words + word;
      let bits = (~this.coverage[address]! & mask) >>> 0;
      this.coverage[address] = (this.coverage[address]! | mask) >>> 0;
      while (bits !== 0) {
        const first = 31 - Math.clz32((bits & -bits) >>> 0);
        const zeros = ~(bits >>> first) >>> 0;
        const length = zeros
          ? Math.min(32 - first, 31 - Math.clz32((zeros & -zeros) >>> 0))
          : 32 - first;
        const y = word * 32 + first;
        if (y === runEnd) {
          runEnd = y + length;
        } else {
          if (runTop !== -1) this.addFragment(x, runTop, runEnd, style);
          runTop = y;
          runEnd = y + length;
        }
        const until = first + length;
        bits = until === 32 ? 0 : (bits & (0xffffffff << until)) >>> 0;
      }
    }
    if (runTop !== -1) this.addFragment(x, runTop, runEnd, style);
  }

  private addFragment(x: number, top: number, bottom: number, style: number): void {
    if (this.fragmentsUsed === this.links.length) this.growFragments();
    const index = this.fragmentsUsed++;
    const offset = index * 3;
    this.fragments[offset] = x;
    this.fragments[offset + 1] = top;
    this.fragments[offset + 2] = bottom - top;
    this.links[index] = -1;
    const previous = this.tails[style]!;
    if (previous === -1) this.heads[style] = index;
    else this.links[previous] = index;
    this.tails[style] = index;
  }

  private growCommands(): void {
    const capacity = this.nextCapacity(this.commandStyles.length, 32768);
    // Both replacement arrays coexist with every retained old array until the swap finishes.
    this.reserve(capacity * COMMAND_BYTES);
    this.allocate(() => {
      const commands = new Int32Array(capacity * 4);
      const styles = new Uint8Array(capacity);
      commands.set(this.commands);
      styles.set(this.commandStyles);
      this.commands = commands;
      this.commandStyles = styles;
    });
  }

  private growFragments(): void {
    const capacity = this.nextCapacity(this.links.length, 8192);
    this.reserve(capacity * FRAGMENT_BYTES);
    this.allocate(() => {
      const fragments = new Int32Array(capacity * 3);
      const links = new Int32Array(capacity);
      fragments.set(this.fragments);
      links.set(this.links);
      this.fragments = fragments;
      this.links = links;
    });
  }

  private nextCapacity(current: number, initial: number): number {
    if (current >= MAX_RECORDS) this.reject("Too many rectangle commands or fragments");
    return Math.min(MAX_RECORDS, Math.max(initial, current * 2));
  }

  private reserve(bytes: number): void {
    if (this.memoryBytes + bytes > MAX_BYTES) this.reject("Rectangle memory budget exceeded");
  }

  private allocate(action: () => void): void {
    try {
      action();
    } catch {
      this.reject("Rectangle array allocation failed");
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new OpaqueRectUnsupportedError("Culler has been disposed");
  }

  private assertRecording(): void {
    this.assertActive();
    if (this.failed || this.ready) this.reject("Frame is not recording");
  }

  private reject(message: string): never {
    this.failed = true;
    this.ready = false;
    this.fragmentsUsed = 0;
    throw new OpaqueRectUnsupportedError(message);
  }
}
