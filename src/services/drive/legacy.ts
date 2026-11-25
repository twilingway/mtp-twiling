import { DriveError } from "./types.js";
import type { Backup } from "../../model/types.js";
import type { DriveAuthorization, DriveInspection } from "./types.js";
import type { DriveBridge, DriveChoice, DriveStatus } from "./coordinator-types.js";
import { summarize } from "./coordinator-types.js";
interface Reader {
  inspect(): Promise<DriveInspection>;
  download(id: string): Promise<Backup>;
}
interface Context {
  epoch: number;
  revision: number;
  authorization: DriveAuthorization;
  remote: Reader;
}
interface Operations {
  capture(): Context | undefined;
  valid(context: Context): boolean;
  reader(authorization: DriveAuthorization): Reader | undefined;
  busy(): boolean;
  setBusy(value: boolean): void;
  applying(context: Context | null): void;
  update(patch: Partial<DriveStatus>): void;
  dirty(): void;
}
/** A separate explicit migration choice. This component has no legacy publish method. */
export class LegacyDriveMigration {
  private preview: { context: Context; heads: string[]; choices: DriveChoice[] } | undefined;
  private decided = false;
  constructor(
    private readonly bridge: DriveBridge,
    private readonly operations: Operations
  ) {}
  reset(): void {
    this.preview = undefined;
    this.decided = false;
  }
  async detect(inspection: DriveInspection): Promise<boolean> {
    if (inspection.heads.length || this.decided) return false;
    const context = this.operations.capture();
    if (!context) return false;
    const reader = this.operations.reader(context.authorization);
    if (!reader) return false;
    const legacy = await reader.inspect();
    this.check(context);
    if (!legacy.heads.length) return false;
    this.operations.update({ legacyAvailable: true, phase: "conflict", conflict: undefined });
    return true;
  }
  private check(context: Context): void {
    if (!this.operations.valid(context))
      throw new DOMException("Профиль или локальные данные изменились", "AbortError");
  }
  async inspect(): Promise<DriveChoice[]> {
    if (this.operations.busy() || this.bridge.profile().blocked)
      throw new DriveError("busy", "Дождитесь завершения операции.");
    const context = this.operations.capture(),
      reader = context && this.operations.reader(context.authorization);
    if (!context || !reader) throw new DriveError("auth-required", "Подключите Google Диск.");
    this.operations.setBusy(true);
    try {
      const modern = await context.remote.inspect();
      this.check(context);
      if (modern.heads.length)
        throw new DriveError(
          "conflict",
          "В формате 2 уже есть облачные данные. Используйте обычный выбор версии."
        );
      const legacy = await reader.inspect();
      this.check(context);
      if (legacy.heads.length > 8) throw new DriveError("limit", "Слишком много legacy снимков.");
      const choices: DriveChoice[] = [];
      for (const nodeId of legacy.heads) {
        const backup = await reader.download(nodeId);
        this.check(context);
        choices.push({ ...summarize(backup), nodeId });
      }
      this.preview = { context, heads: legacy.heads, choices };
      return choices;
    } finally {
      this.operations.setBusy(false);
    }
  }
  async choose(nodeId: string): Promise<void> {
    const preview = this.preview;
    if (!preview || this.operations.busy() || this.bridge.profile().blocked) return;
    this.check(preview.context);
    const reader = this.operations.reader(preview.context.authorization);
    if (!reader) return;
    this.operations.setBusy(true);
    try {
      const modern = await preview.context.remote.inspect();
      this.check(preview.context);
      if (modern.heads.length)
        throw new DriveError("conflict", "Формат 2 изменился. Повторите выбор.");
      const current = await reader.inspect();
      this.check(preview.context);
      if ([...current.heads].sort().join() !== [...preview.heads].sort().join())
        throw new DriveError("conflict", "Legacy снимки изменились. Повторите выбор.");
      if (nodeId !== "local" && !preview.heads.includes(nodeId))
        throw new DriveError("remote-invalid", "Неизвестный снимок.");
      if (nodeId !== "local") {
        const incoming = await reader.download(nodeId);
        this.check(preview.context);
        if (!incoming.layout || !incoming.watchlist || !incoming.views)
          throw new DriveError("remote-invalid", "Неполный legacy снимок.");
        this.operations.applying(preview.context);
        try {
          await this.bridge.importBackup(
            { ...incoming, schemaVersion: 2 },
            {
              replacePortable: true,
              signal: preview.context.authorization.signal,
              valid: () => this.operations.valid(preview.context)
            }
          );
          this.check(preview.context);
        } finally {
          this.operations.applying(null);
        }
      }
      this.decided = true;
      this.preview = undefined;
      this.operations.update({ legacyAvailable: false, phase: "idle", conflict: undefined });
      this.operations.dirty();
    } finally {
      this.operations.setBusy(false);
    }
  }
}
