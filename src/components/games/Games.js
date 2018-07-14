import React from 'react'
import Game from '../game/Game'
import './Games.css'

const GameRows = props =>
  props.games.map(game => (
    <Game game={game} label={props.label} key={game.id} />
  ))

const Games = ({ label, games }) =>
  !games ? null : (
    <div className="games-table">
      <GameRows games={games} label={label} />
    </div>
  )

export default Games
