import React from 'react'
import { Link } from 'react-router-dom'
import Image from '../image/Image'
import './Game.css'

const dateFormat = dateString => {
  const date = new Date(dateString)

  return `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`
}

const Price = props => {
  const { label, date, discountDate, price } = props

  return label === 'discounted' ? (
    <React.Fragment>
      {dateFormat(discountDate)}
      <div className="game-price">{dateFormat(date)}</div>
      <div className="game-price">{price}</div>
    </React.Fragment>
  ) : (
    <React.Fragment>
      {dateFormat(date)}
      <div className="game-price">{price}</div>
    </React.Fragment>
  )
}

const Game = props => {
  const { label, game } = props
  const { date, discountDate, id, name, price, url } = game

  return (
    <div className="game-separator">
      <Link to={`/g/${id}`}>
        <div className="game-row">
          <div className="game-cell game-image">
            <Image name={name} url={url} />
          </div>

          <div className="game-cell game-name">{name}</div>

          <div className="game-cell game-date">
            <Price
              date={date}
              discountDate={discountDate}
              price={price}
              label={label}
            />
          </div>
        </div>
      </Link>
    </div>
  )
}

export default Game
