import React from 'react'
import { Link } from 'react-router-dom'
import { DateTime } from 'luxon'
import Image from './Image'
import './Game.css'

let lastDay = ''

const DateHeader = ({ date }) => <div className="game--date">{date}</div>

const Game = ({ game }) => {
  const { id, name, url, date } = game

  const dateTime = DateTime.fromISO(date)
  const day = dateTime.toLocaleString({
    weekday: 'long',
    month: 'numeric',
    day: '2-digit',
    year: 'numeric'
  })
  const drawHeader = lastDay !== day

  lastDay = day

  return (
    <React.Fragment>
      {drawHeader && <DateHeader date={day} />}

      <div className="game--tile">
        <Link to={`/g/${id}`}>
          <Image url={url} name={name} />
        </Link>
      </div>
    </React.Fragment>
  )
}

export default Game
