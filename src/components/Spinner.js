import React from 'react'
import './Spinner.css'

const Loading = ({ loading }) =>
  loading === false ? null : <div className="spinner" />

export default Loading
