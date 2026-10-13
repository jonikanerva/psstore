import fs from 'node:fs/promises'
import path from 'node:path'

// The compatibility anchors must come from production code of the server. A
// string in a test fixture must not satisfy an anchor.

// True for a production Rust file: a `.rs` file that is not `tests.rs` and is
// not under a `tests` directory. The path is relative to the scanned
// directory.
export const isProductionRustFile = (relativePath: string): boolean => {
  const parts = relativePath.split(path.sep)
  return (
    relativePath.endsWith('.rs') &&
    parts.at(-1) !== 'tests.rs' &&
    !parts.slice(0, -1).includes('tests')
  )
}

// An inline test module: `#[cfg(test)]`, other attributes, then `mod name {`.
// A declaration of an out-of-line module (`mod tests;`) does not match.
const INLINE_TEST_MODULE =
  /#\[cfg\(test\)\]\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*\{/

// The source without its inline test module. The Clippy lint
// `items_after_test_module` (in `clippy::all`, which `mise run lint` denies)
// keeps that module last in its file, so the text from the module to the end
// is test code. A `#[cfg(test)]` item outside a test module stays in.
export const withoutInlineTestModule = (source: string): string => {
  const match = INLINE_TEST_MODULE.exec(source)
  return match === null ? source : source.slice(0, match.index)
}

export const readProductionRustFile = async (
  filePath: string,
): Promise<string> =>
  withoutInlineTestModule(await fs.readFile(filePath, 'utf8'))

// The production code of all Rust files under `dir`, in path order.
export const readProductionRustSources = async (
  dir: string,
): Promise<string> => {
  const entries = await fs.readdir(dir, { recursive: true })
  const files = entries.filter(isProductionRustFile).sort()
  if (files.length === 0) {
    throw new Error(`No production Rust sources under ${dir}`)
  }
  const texts = await Promise.all(
    files.map((file) => readProductionRustFile(path.join(dir, file))),
  )
  return texts.join('\n')
}
