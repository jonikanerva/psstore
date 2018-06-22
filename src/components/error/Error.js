import React from 'react'
import './Error.css'

export const Error = props => {
  if (props.error === false) {
    return null
  }

  return <div className="error">an error occured ¯\_(ツ)_/¯</div>
}
