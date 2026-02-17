import { Fragment } from 'react'
import { NavLink, useParams } from 'react-router-dom'
import Screenshots from './Screenshots'

const Details = () => {
  const params = useParams<{ gameId: string }>()
  const gameId = params.gameId || ''
  return (
    <Fragment>
      <div className="navigation">
        <NavLink to="/new" className="navigation--link">
          Home
        </NavLink>
      </div>
      <Screenshots gameId={gameId} />
    </Fragment>
  )
}

export default Details
