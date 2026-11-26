/** A small cache for formatter options that can vary with imported preferences. */
export function intlCache<Value>() {
  const entries = new Map<string, Value>();
  return (key: string, create: () => Value): Value => {
    const cached = entries.get(key);
    if (cached !== undefined) return cached;
    const value = create();
    if (entries.size >= 64) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) entries.delete(oldest);
    }
    entries.set(key, value);
    return value;
  };
}
