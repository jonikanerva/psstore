import React, { Component } from 'react'
import './Screenshots.css'

class Screenshots extends Component {
  constructor(props) {
    super(props)

    this.state = {
      name: props.name,
      onClose: props.onClose,
      screenshots: props.screenshots
    }
  }

  render() {
    const { name, screenshots } = this.state

    return !this.props.show ? null : (
      <div className="screenshots-modal">
        {screenshots.map((screenshot, i) => (
          <img src={screenshot} alt={name} key={i} />
        ))}
      </div>
    )
  }
}

export default Screenshots
