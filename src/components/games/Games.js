import React from 'react'
import Game from '../game/Game'
import Loading from '../spinner/Spinner'
import './Games.css'

const Header = ({ label, linkto, loading }) => (
  <a name={label} href={`#${linkto}`}>
    <div className="games-header">
      <div>{label}</div>
      <div className="games-header-loading">
        <Loading loading={loading} />
      </div>
    </div>
  </a>
)

const GameRows = ({ games, label }) =>
  games.map(game => <Game game={game} label={label} key={game.id} />)

const Games = ({ label, linkto, loading, games }) =>
  !games ? null : (
    <div className="games-list">
      <Header label={label} linkto={linkto} loading={loading} />

      <div className="games-table">
        <GameRows games={games} label={label} />
      </div>
    </div>
  )

export default Games
