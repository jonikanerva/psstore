import React from 'react'
import './Spinner.css'

const Loading = props => {
  if (props.loading === false) {
    return null
  }

  return <div className="spinner" />
}

export default Loading
