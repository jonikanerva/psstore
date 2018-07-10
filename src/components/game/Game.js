import React from 'react'
import Image from '../image/Image'
import Screenshots from '../screenshots/Screenshots'
import './Game.css'

const storeUrl = id => `https://store.playstation.com/en-fi/product/${id}`
const dateFormat = dateString => {
  const date = new Date(dateString)

  return `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`
}

const Price = props => {
  const { sort, date, discountDate, price } = props

  return sort === 'discount' ? (
    <div className="game-cell game-date">
      {dateFormat(discountDate)}
      <div className="game-price">{dateFormat(date)}</div>
      <div className="game-price">{price}</div>
    </div>
  ) : (
    <div className="game-cell game-date">
      {dateFormat(date)}
      <div className="game-price">{price}</div>
    </div>
  )
}

class Game extends React.Component {
  constructor(props) {
    super(props)

    this.state = {
      showScreenshots: false
    }
  }

  toggleScreenshots = e => {
    this.setState({
      showScreenshots: !this.state.showScreenshots
    })

    // prevent scrolling on body when the screenshots are visible
    document.body.style.overflow = this.state.showScreenshots
      ? 'visible'
      : 'hidden'

    e.preventDefault()
  }

  render() {
    const { date, discountDate, id, name, price, url } = this.props.game
    const { sort } = this.props

    return (
      <div className="game-separator">
        <Screenshots
          game={this.props.game}
          show={this.state.showScreenshots}
          onClose={this.toggleScreenshots}
        />

        <a href={storeUrl(id)}>
          <div className="game-row">
            <div
              className="game-cell game-image"
              onClick={this.toggleScreenshots}
            >
              <Image name={name} url={url} />
            </div>

            <div className="game-cell game-name">{name}</div>

            <Price
              date={date}
              discountDate={discountDate}
              price={price}
              sort={sort}
            />
          </div>
        </a>
      </div>
    )
  }
}

export default Game
