import React from 'react'
import Game from '../game/Game'
import './Games.css'

const GameRows = ({ label, games }) =>
  games.map(game => (
    <Game game={game} label={label} key={game.id} />
  ))

const Games = ({ label, games }) =>
  !games ? null : (
    <ul className="games-list__items">
      <GameRows games={games} label={label} />
    </ul>
  )

export default Games
