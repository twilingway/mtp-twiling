/** A store snapshot stays referentially stable while its selected fields are unchanged. */
export function selectedSnapshot<State, Selection>(
  getSnapshot: () => State,
  select: (state: State) => Selection,
  equal: (before: Selection, next: Selection) => boolean = Object.is
): () => Selection {
  let cached: { state: State; selection: Selection } | undefined;
  return () => {
    const state = getSnapshot();
    if (cached && Object.is(cached.state, state)) return cached.selection;
    const next = select(state);
    const selection = cached && equal(cached.selection, next) ? cached.selection : next;
    cached = { state, selection };
    return selection;
  };
}

export function shallowEqual<T extends object>(before: T, next: T): boolean {
  const keys = Object.keys(before) as (keyof T)[];
  return (
    keys.length === Object.keys(next).length &&
    keys.every((key) => Object.hasOwn(next, key) && Object.is(before[key], next[key]))
  );
}
