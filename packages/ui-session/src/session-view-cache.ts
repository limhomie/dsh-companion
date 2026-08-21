const DEFAULT_SESSION_VIEW_CACHE_CAPACITY = 3

/**
 * Tracks the bounded set of mounted Session views without caching Harness state.
 * Entries stay in insertion order so a cache hit does not move an existing DOM tree.
 */
export class SessionViewCache<T extends string> {
  private readonly entries = new Map<T, true>()
  private recency: T[] = []
  private snapshot: readonly T[] = Object.freeze([])

  constructor(private readonly capacity = DEFAULT_SESSION_VIEW_CACHE_CAPACITY) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError('Session view cache capacity must be a positive safe integer')
    }
  }

  getSnapshot(): readonly T[] {
    return this.snapshot
  }

  /** Activate one eligible Session and evict the least recently used view when full. */
  activate(id: T, eligibleIds: readonly T[]): readonly T[] {
    const eligible = new Set(eligibleIds)
    this.removeIneligible(eligible)
    if (!eligible.has(id)) return this.publish()

    if (this.entries.has(id)) {
      this.recency = [...this.recency.filter(candidate => candidate !== id), id]
      return this.snapshot
    }

    while (this.entries.size >= this.capacity) {
      const evicted = this.recency.shift()
      if (evicted === undefined) break
      this.entries.delete(evicted)
    }
    this.entries.set(id, true)
    this.recency.push(id)
    return this.publish()
  }

  /** Remove views no longer present in the authoritative Host list. */
  reconcile(eligibleIds: readonly T[]): readonly T[] {
    this.removeIneligible(new Set(eligibleIds))
    return this.publish()
  }

  /** Release all retained view identities when the owning Route unmounts. */
  clear(): void {
    this.entries.clear()
    this.recency = []
    this.publish()
  }

  private removeIneligible(eligible: ReadonlySet<T>): void {
    for (const id of this.entries.keys()) {
      if (!eligible.has(id)) this.entries.delete(id)
    }
    this.recency = this.recency.filter(id => eligible.has(id))
  }

  private publish(): readonly T[] {
    const next = [...this.entries.keys()]
    if (next.length === this.snapshot.length && next.every((id, index) => id === this.snapshot[index])) {
      return this.snapshot
    }
    this.snapshot = Object.freeze(next)
    return this.snapshot
  }
}
