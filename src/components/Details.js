import React from 'react'
import { NavLink } from 'react-router-dom'
import Screenshots from './Screenshots'

const Details = (props) => (
  <React.Fragment>
    <div className="navigation">
      <NavLink to="/" className="navigation--link">
        Home
      </NavLink>
    </div>
    <Screenshots gameId={props.match.params.gameId} />
  </React.Fragment>
)
export default Details
