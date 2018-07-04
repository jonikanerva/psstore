import React from 'react'
import './Screenshots.css'

const Screenshots = props => {
  if (!props.show) {
    return null
  }

  return (
    <div className="screenshots-backdrop">
      <div className="screenshots-modal">
        {props.screenshots.map((screenshot, i) => (
          <div key={i}>
            <img src={screenshot} alt={props.name} />
          </div>
        ))}
      </div>
    </div>
  )
}

export default Screenshots
