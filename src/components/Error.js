import React from 'react'
import './Error.css'

const Error = (props) => (
  <div className="error">{props.message || 'an error occured ¯\\_(ツ)_/¯'}</div>
)

export default Error
