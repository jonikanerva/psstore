import React from 'react'
import './Spinner.css'

const Spinner = () => (
  <div className="spinner--modal">
    <div className="spinner" />
  </div>
)

const Loading = ({ loading }) => (loading === false ? null : <Spinner />)

export default Loading
