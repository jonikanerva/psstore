import React, { Fragment } from 'react'
import { NavLink, RouteComponentProps } from 'react-router-dom'
import Screenshots from './Screenshots'

interface DetailsProps {
  gameId: string
}

const Details = (props: RouteComponentProps<DetailsProps>): JSX.Element => (
  <Fragment>
    <div className="navigation">
      <NavLink to="/" className="navigation--link">
        Home
      </NavLink>
    </div>
    <Screenshots gameId={props.match.params.gameId} />
  </Fragment>
)
export default Details
