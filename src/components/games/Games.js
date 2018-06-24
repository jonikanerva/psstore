import React from 'react'
import * as R from 'ramda'
import { Error } from '../error/Error'
import { Loading } from '../spinner/Spinner'
import { fetchGames } from '../../modules/psnStore'
import './Games.css'

const storeUrl = id => `https://store.playstation.com/en-fi/product/${id}`
const dateFormat = dateString => {
  const date = new Date(dateString)

  return `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`
}
const sortGames = sort => {
  switch (sort) {
    case 'desc':
      return R.sort(R.descend(R.prop('date')))
    case 'discount':
      return R.sortWith([
        R.descend(R.prop('discountDate')),
        R.descend(R.prop('date'))
      ])
    default:
      return R.sort(R.ascend(R.prop('date')))
  }
}

const Rows = props =>
  props.games.map(({ name, date, url, id, price }) => (
    <div key={id} className="separator">
      <a href={storeUrl(id)}>
        <div className="gamerow">
          <div className="gamecell image">
            <img src={url} alt={name} />
          </div>

          <div className="gamecell name">{name}</div>

          <div className="gamecell date">
            {dateFormat(date)}
            <div className="price">{price}</div>
          </div>
        </div>
      </a>
    </div>
  ))

class Games extends React.Component {
  constructor(props) {
    super(props)

    this.state = {
      error: false,
      loading: true,
      sort: props.sort,
      url: props.url
    }
  }

  componentDidMount() {
    fetchGames(this.state.url)
      .then(sortGames(this.state.sort))
      .then(games => this.setState({ games, loading: false }))
      .catch(() => this.setState({ error: true }))
  }

  render() {
    const showGames = !this.state.loading && !this.state.error

    return (
      <div className="gametable">
        <Error error={this.state.error} />
        <Loading loading={this.state.loading} />
        {showGames && <Rows games={this.state.games} />}
      </div>
    )
  }
}

export default Games
