import { Schema } from 'effect'
import { readTextFile } from '../io/files.js'

// `docs/contracts/sony-constants.json` holds the fixed Sony contract values:
// the endpoint, the operation names, the persisted-query hashes, the sign-in
// client values, and the locale. It is one flat JSON object of strings. The
// server compiles the same file in, so the bot and the server read one source.
export type SonyConstants = ReadonlyMap<string, string>

export const SONY_CONSTANTS_FILE = 'docs/contracts/sony-constants.json'

const sonyConstantsSchema = Schema.Record(Schema.String, Schema.String)

// Fails for text that is not a JSON object with string values only. A missing
// key is not an error here: each reader reports its own missing key.
export const parseSonyConstants = (text: string): SonyConstants => {
  try {
    const decoded = Schema.decodeUnknownSync(sonyConstantsSchema)(
      JSON.parse(text),
    )
    return new Map(Object.entries(decoded))
  } catch {
    throw new Error(
      `${SONY_CONSTANTS_FILE} must be a JSON object with string values only`,
    )
  }
}

export const readSonyConstants = async (
  filePath: string,
): Promise<SonyConstants> => parseSonyConstants(await readTextFile(filePath))

// The value of one constant, or null when the file has no such key or an
// empty value.
export const sonyConstant = (
  constants: SonyConstants,
  name: string,
): string | null => {
  const value = constants.get(name)
  return value === undefined || value === '' ? null : value
}
