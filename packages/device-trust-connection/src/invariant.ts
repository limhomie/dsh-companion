/**
 * Package-owned invariant companion for `@dsh-companion/device-trust-connection`.
 * @module @dsh-companion/device-trust-connection/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-companion/device-trust-connection'

/** Cordis companion plugin name. */
export const name = 'device-trust-connection-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: Connection and WebServer registries own guard, route, downlink, and disposal relationships. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
