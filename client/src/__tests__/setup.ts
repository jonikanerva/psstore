import '@testing-library/jest-dom/vitest'

// jsdom does not implement scrolling; the router's scroll restoration calls it.
window.scrollTo = () => undefined
