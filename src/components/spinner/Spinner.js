import React from 'react'
import './Spinner.css'

export const Loading = props => {
  if (props.loading === false) {
    return null
  }

  return <div className="spinner" />
}
