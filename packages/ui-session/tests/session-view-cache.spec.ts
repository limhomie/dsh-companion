import { describe, expect, it } from 'vitest'
import { SessionViewCache } from '../src/session-view-cache.ts'

describe('Session view cache', () => {
  it('keeps recent views in stable DOM order and evicts the least recently used view', () => {
    const cache = new SessionViewCache<string>(3)

    expect(cache.activate('alpha', ['alpha', 'beta', 'gamma', 'delta'])).toEqual(['alpha'])
    expect(cache.activate('beta', ['alpha', 'beta', 'gamma', 'delta'])).toEqual(['alpha', 'beta'])
    const threeViews = cache.activate('gamma', ['alpha', 'beta', 'gamma', 'delta'])
    expect(threeViews).toEqual(['alpha', 'beta', 'gamma'])

    expect(cache.activate('alpha', ['alpha', 'beta', 'gamma', 'delta'])).toBe(threeViews)
    expect(cache.activate('delta', ['alpha', 'beta', 'gamma', 'delta'])).toEqual(['alpha', 'gamma', 'delta'])
  })

  it('drops Host-removed views and clears every identity with its owner', () => {
    const cache = new SessionViewCache<string>(3)
    cache.activate('alpha', ['alpha', 'beta'])
    cache.activate('beta', ['alpha', 'beta'])

    expect(cache.reconcile(['beta'])).toEqual(['beta'])
    cache.clear()
    expect(cache.getSnapshot()).toEqual([])
  })

  it('rejects an unbounded or empty capacity', () => {
    expect(() => new SessionViewCache(0)).toThrow(RangeError)
    expect(() => new SessionViewCache(Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })
})
