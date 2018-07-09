import React from 'react'
import Image from '../image/Image'
import Screenshots from '../screenshots/Screenshots'

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
      <div>
        <Screenshots
          game={this.props.game}
          show={this.state.showScreenshots}
          onClose={this.toggleScreenshots}
        />

        <a href={storeUrl(id)}>
          <div className="gamerow">
            <div className="gamecell image" onClick={this.toggleScreenshots}>
              <Image name={name} url={url} />
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
      </div>
    )
  }
}

export default Game
