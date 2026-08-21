/**
 * Package-owned invariant companion for `@dsh-companion/device-trust-local`.
 * @module @dsh-companion/device-trust-local/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-companion/device-trust-local'

/** Cordis companion plugin name. */
export const name = 'device-trust-local-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: storage-domain validates durable device records, and
 * the Service Definition companion owns the emitted revocation relationship.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
