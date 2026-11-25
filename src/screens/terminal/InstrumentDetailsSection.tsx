import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Candle } from "../../model/types.js";
import type {
  InstrumentDetailsRepository,
  Result,
  Section,
  SectionData
} from "../../services/instrument-details/repository.js";
import { detailDate, detailError, detailText as l } from "./InstrumentDetailsText.js";

interface Props<K extends Section> {
  repository: InstrumentDetailsRepository;
  uid: string;
  section: K;
  seed: Candle[];
  valid: () => boolean;
  children: (data: SectionData[K]) => ReactNode;
}
export function InstrumentDetailsLoad<K extends Section>({
  repository,
  uid,
  section,
  seed,
  valid,
  children
}: Props<K>) {
  const [retry, setRetry] = useState(0),
    [stopped, setStopped] = useState(false);
  const [result, setResult] = useState<{
    repository: InstrumentDetailsRepository;
    uid: string;
    result: Result<SectionData[K]>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null),
    [progress, setProgress] = useState<[number, number]>([0, 0]);
  const generation = useRef(0),
    active = useRef<AbortController | null>(null);
  const latest = useRef({ seed, valid });
  latest.current = { seed, valid };
  useEffect(() => {
    const abort = new AbortController(),
      current = ++generation.current;
    active.current = abort;
    setResult(null);
    setError(null);
    setProgress([0, 0]);
    setStopped(false);
    const alive = () =>
      !abort.signal.aborted && generation.current === current && latest.current.valid();
    void (async () => {
      try {
        const loaded = await repository.load(
          uid,
          section,
          abort.signal,
          latest.current.seed,
          (done, total) => {
            if (alive()) setProgress([done, total]);
          }
        );
        if (alive()) setResult({ repository, uid, result: loaded });
      } catch (error) {
        if (alive()) setError(detailError(error));
      }
    })();
    return () => {
      generation.current = current + 1;
      abort.abort();
    };
  }, [repository, uid, section, retry]);
  const visible =
    result?.repository === repository && result.uid === uid && latest.current.valid()
      ? result.result
      : null;
  return (
    <div className="instrument-details-content" aria-busy={!visible && !error && !stopped}>
      {visible ? (
        <>
          {children(visible.data)}
          <p className="instrument-details-source">
            T-Invest · {l("Получено", "Retrieved")} {detailDate(visible.receivedAt)} · UTC
          </p>
        </>
      ) : error ? (
        <p role="status">{error}</p>
      ) : stopped ? (
        <p role="status">{l("Загрузка отменена.", "Loading cancelled.")}</p>
      ) : (
        <p role="status">
          {l("Загрузка…", "Loading…")} {progress[1] > 1 ? `${progress[0]}/${progress[1]}` : ""}
        </p>
      )}
      {error || stopped ? (
        <button type="button" onClick={() => setRetry((value) => value + 1)}>
          {l("Повторить", "Retry")}
        </button>
      ) : (
        !visible && (
          <button
            type="button"
            onClick={() => {
              active.current?.abort();
              setStopped(true);
            }}
          >
            {l("Отменить", "Cancel")}
          </button>
        )
      )}
    </div>
  );
}
export function InstrumentDetailsAccordion({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="instrument-details-section"
      onToggle={(event) => {
        if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
      }}
    >
      <summary>{title}</summary>
      {open && children}
    </details>
  );
}
