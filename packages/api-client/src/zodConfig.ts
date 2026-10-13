// The server sends a Content-Security-Policy without `'unsafe-eval'`. Unless
// `jitless` is set, Zod compiles object parsers with `new Function`, and its
// probe for that alone makes the browser report a CSP violation. Zod reads
// the setting when it builds a schema, so the facade imports this module
// before the generated schemas.
import { config } from 'zod'

config({ jitless: true })
