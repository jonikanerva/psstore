import React from 'react'
import { Link } from 'react-router-dom'
import Image from './Image'

import './Game.css'

const Game = ({ id, name, url }) => (
  <div className="game--tile">
    <Link to={`/g/${id}`}>
      <Image url={url} name={name} />
    </Link>
  </div>
)

export default Game
