import React from 'react'
import './Screenshots.css'

export const Screenshots = props => {
  if (!props.show) {
    return null
  }

  return (
    <div className="screenshot--backdrop">
      <div className="screenshot--modal">
        {props.screenshots.map(screenshot => (
          <div>
            <img src={screenshot} alt={props.name} />
          </div>
        ))}
      </div>
    </div>
  )
}

export default Screenshots
