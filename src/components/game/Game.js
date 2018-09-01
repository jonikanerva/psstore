import React from 'react'
import { Link } from 'react-router-dom'
import Image from '../image/Image'
import './Game.css'

const dateFormat = dateString => {
  const date = new Date(dateString)

  return `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`
}

const DiscountedPrice = ({ date, discountDate, price }) => (
  <React.Fragment>
    {dateFormat(discountDate)}
    <div className="game--price">{dateFormat(date)}</div>
    <div className="game--price">{price}</div>
  </React.Fragment>
)

const Price = ({ date, price }) => (
  <React.Fragment>
    {dateFormat(date)}
    <div className="game--price">{price}</div>
  </React.Fragment>
)

const Game = ({ label, game }) => {
  const { date, discountDate, id, name, price, url } = game

  return (
    <div className="game--separator">
      <Link to={`/g/${id}`}>
        <div className="game--row">
          <div className="game--cell">
            <div className="game--image">
              <Image name={name} url={url} />
            </div>
          </div>

          <div className="game--cell game--name">{name}</div>

          <div className="game--cell game--date">
            {label === 'discounted' ? (
              <DiscountedPrice
                date={date}
                discountDate={discountDate}
                price={price}
              />
            ) : (
              <Price date={date} price={price} />
            )}
          </div>
        </div>
      </Link>
    </div>
  )
}

export default Game
