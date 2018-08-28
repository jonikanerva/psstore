import React from 'react'
import { Link } from 'react-router-dom'
import Image from '../image/Image'
import './Game.css'

const dateFormat = dateString => {
  const date = new Date(dateString)
  return `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`
}

const Price = ({ label, date, discountDate, price }) => {

  return label === 'discounted' ? (
    <React.Fragment>
      <p className="game-item__text game-item__text--highlight">{price}</p>
      <p className="game-item__text game-item__text--highlight game-item__text--small ">Until {dateFormat(discountDate)}</p>
    </React.Fragment>
  ) : (
    <React.Fragment>
      <p className="game-item__text">{price}</p>
    </React.Fragment>
  )
}

const Game = ({label, game}) => {

  const { date, genres, studio, discountDate, id, name, price, url } = game

  return (
    <li className="game-item">
      <Link className="game-item__container" to={`/g/${id}`}>
        <div className="game-item__image">
          <Image name={name} url={url} />
        </div>
        <div className="game-item__description">
          <p className="game-item__text game-item__text--small">{dateFormat(date)}</p>
          <h2 className="game-item__title">{name}</h2>
          <Price
            date={date}
            discountDate={discountDate}
            price={price}
              label={label} />
          <p className="game-item__text game-item__text--footer">
            {genres}, {studio}
          </p>
        </div>
      </Link>
    </li>
  )
}

export default Game
