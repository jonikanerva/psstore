import React from 'react'
import Image from '../image/Image'

const storeUrl = id => `https://store.playstation.com/en-fi/product/${id}`
const dateFormat = dateString => {
  const date = new Date(dateString)

  return `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`
}

const Price = props => {
  const { sort, date, discountDate, price } = props

  return sort === 'discount' ? (
    <div className="gamecell date">
      {dateFormat(discountDate)}
      <div className="price">{dateFormat(date)}</div>
      <div className="price">{price}</div>
    </div>
  ) : (
    <div className="gamecell date">
      {dateFormat(date)}
      <div className="price">{price}</div>
    </div>
  )
}

const Game = props => {
  const {
    date,
    description,
    discountDate,
    genres,
    id,
    name,
    price,
    screenShots,
    studio,
    url,
    videos
  } = props.game
  const { sort } = props

  return (
    <a href={storeUrl(id)}>
      <div className="gamerow">
        <div className="gamecell image">
          <Image
            description={description}
            genres={genres}
            name={name}
            screenshots={screenShots}
            studio={studio}
            url={url}
            videos={videos}
          />
        </div>

        <div className="gamecell name">{name}</div>

        <Price
          date={date}
          discountDate={discountDate}
          price={price}
          sort={sort}
        />
      </div>
    </a>
  )
}

export default Game
