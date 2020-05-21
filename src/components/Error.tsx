import React from 'react'
import './Error.css'

interface ErrorProps {
  message?: string
}
const Error = (props: ErrorProps): JSX.Element => (
  <div className="error">{props.message || 'an error occured ¯\\_(ツ)_/¯'}</div>
)

export default Error
