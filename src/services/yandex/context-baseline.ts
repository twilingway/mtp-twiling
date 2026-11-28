import type { YandexAssociation, YandexJournal } from "./journal.js";
import type {
  CloudOperationGuard,
  CloudSyncHost
} from "../../screens/terminal/controller-cloud-host.js";
import { YandexError } from "./types.js";

const heads = (association: YandexAssociation | undefined) =>
  JSON.stringify([...(association?.heads ?? [])].sort());

/** The durable journal is shared by tabs; the runtime's accepted baseline is not. */
export class YandexContextBaseline {
  private association: YandexAssociation | undefined;
  private revision = 0;
  private accountId: string | undefined;
  private opening:
    | Promise<{ value?: ReadonlyMap<string, YandexAssociation> | undefined; error?: unknown }>
    | undefined;
  private openingRevision = 0;
  open(journal: YandexJournal, clientId: string | undefined, revision: number): void {
    this.openingRevision = revision;
    if (clientId)
      this.opening = journal.snapshotAssociations(clientId).then(
        (value) => ({ value }),
        (error: unknown) => ({ error })
      );
  }
  async restore(
    accountId: string,
    durable: YandexAssociation | undefined,
    revision: number
  ): Promise<YandexAssociation | undefined> {
    if (this.accountId === accountId) return this.association;
    const opening = await this.opening;
    if (opening?.error) throw new YandexError("local-save");
    this.accountId = accountId;
    this.initialize(
      opening?.value ? opening.value.get(accountId) : durable,
      opening?.value ? this.openingRevision : revision
    );
    return this.association;
  }
  initialize(association: YandexAssociation | undefined, revision: number): void {
    this.association = association;
    this.revision = revision;
  }
  accepted(association: YandexAssociation, revision: number): void {
    this.initialize(association, revision);
  }
  unchanged(revision: number): boolean {
    return !!this.association && revision === this.revision;
  }
  async operation(
    host: CloudSyncHost,
    guard: CloudOperationGuard,
    journal: YandexJournal,
    clientId: string,
    accountId: string,
    readOnly: boolean
  ) {
    if (readOnly && !this.unchanged(host.scope("yandex-disk").revision)) return undefined;
    return {
      value: await this.beforeCapture(
        await journal.association(clientId, accountId),
        host,
        guard,
        !readOnly
      )
    };
  }
  async beforeCapture(
    durable: YandexAssociation | undefined,
    host: CloudSyncHost,
    guard: CloudOperationGuard,
    allowRefresh = true
  ): Promise<YandexAssociation | undefined> {
    if (heads(durable) === heads(this.association)) return durable;
    const scope = host.scope("yandex-disk");
    if (!this.association || !durable || scope.revision !== this.revision || !host.refresh)
      return this.association;
    if (!allowRefresh) throw new YandexError("local-changed");
    if (scope.blocked || scope.associationConflict) throw new YandexError("local-changed");
    await host.refresh("yandex-disk", scope.revision, guard);
    guard.signal.throwIfAborted();
    if (!guard.isCurrent()) throw new YandexError("local-changed");
    this.initialize(durable, host.scope("yandex-disk").revision);
    return durable;
  }
}
