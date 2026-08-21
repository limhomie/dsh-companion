/**
 * Package-owned invariant companion for `@dsh-companion/device-trust`.
 * @module @dsh-companion/device-trust/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-companion/device-trust'

/** Cordis companion plugin name. */
export const name = 'device-trust-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** A revocation event names a relationship owned by the live provider. */
const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure) => {
  ctx.on('device-trust/revoked', (deviceId) => {
    if (ctx.get('deviceTrust') === undefined) {
      fail(`device-trust/revoked for "${deviceId}" emitted without a live deviceTrust service`)
    }
  })
  ctx.on('device-trust/access-updated', (deviceId) => {
    if (ctx.get('deviceTrust') === undefined) {
      fail(`device-trust/access-updated for "${deviceId}" emitted without a live deviceTrust service`)
    }
  })
}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
