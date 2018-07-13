const isSupported = () => {
  const testString = 'test'

  try {
    window.localStorage.setItem(testString, testString)
    window.localStorage.removeItem(testString)

    return true
  } catch (e) {
    return false
  }
}

const setItem = (id, value) => {
  if (!isSupported()) {
    return null
  }

  window.localStorage.setItem(id, JSON.stringify(value))
}

const getItem = id => {
  if (!isSupported()) {
    return null
  }

  const value = window.localStorage.getItem(id)

  return value ? JSON.parse(value) : null
}

export default { getItem, setItem }
