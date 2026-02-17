export const getSearchQuery = (search: string): string => {
  const params = new URLSearchParams(search)
  return params.get('q')?.trim() ?? ''
}
