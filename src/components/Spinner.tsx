import React from 'react'
import './Spinner.css'

const Spinner = (): JSX.Element => (
  <div className="spinner--modal">
    <div className="spinner" />
  </div>
)

interface LoadingProps {
  loading: boolean
}

const Loading = ({ loading }: LoadingProps): JSX.Element | null =>
  loading === false ? null : <Spinner />

export default Loading
