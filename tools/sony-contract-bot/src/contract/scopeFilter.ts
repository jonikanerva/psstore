import type { ContractOperation } from './types.js'

const includesPs5 = (value: unknown): boolean => {
  if (typeof value === 'string') {
    return value.toUpperCase().includes('PS5')
  }

  if (Array.isArray(value)) {
    return value.some((entry) => includesPs5(entry))
  }

  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((entry) => includesPs5(entry))
  }

  return false
}

const includesEur = (value: unknown): boolean => {
  if (typeof value === 'string') {
    return value.toUpperCase().includes('EUR') || value.includes('€')
  }

  if (Array.isArray(value)) {
    return value.some((entry) => includesEur(entry))
  }

  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((entry) => includesEur(entry))
  }

  return false
}

const includesFiFi = (value: unknown): boolean => {
  if (typeof value === 'string') {
    return value.toLowerCase().includes('fi-fi')
  }

  if (Array.isArray(value)) {
    return value.some((entry) => includesFiFi(entry))
  }

  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((entry) => includesFiFi(entry))
  }

  return false
}

const includesValue = (value: unknown, needle: string): boolean => {
  if (typeof value === 'string') {
    return value.toLowerCase().includes(needle.toLowerCase())
  }

  if (Array.isArray(value)) {
    return value.some((entry) => includesValue(entry, needle))
  }

  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((entry) => includesValue(entry, needle))
  }

  return false
}

export const filterOperationsByFinnishPs5EurScope = (
  operations: ContractOperation[],
): ContractOperation[] =>
  operations.filter((operation) => {
    const bundle = {
      ...operation.variables_schema,
      ...operation.sample_variables,
    }

    const localeOk = includesFiFi(bundle) || !includesValue(bundle, 'en-us')
    const platformOk = includesPs5(bundle)
    const currencyOk = includesEur(bundle) || !includesValue(bundle, 'usd')

    return localeOk && platformOk && currencyOk
  })
