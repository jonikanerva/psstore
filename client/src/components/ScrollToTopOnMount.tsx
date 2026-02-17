import React from 'react'

class ScrollToTopOnMount extends React.Component {
  componentDidMount(): void {
    window.scrollTo(0, 0)
  }

  render(): null {
    return null
  }
}

export default ScrollToTopOnMount
