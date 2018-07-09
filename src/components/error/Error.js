import React from 'react'
import './Error.css'

const Error = props => {
  if (props.error === false) {
    return null
  }

  return <div className="error">an error occured ¯\_(ツ)_/¯</div>
}

export default Error
