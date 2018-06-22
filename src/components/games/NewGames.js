import React from 'react'
import * as R from 'ramda'
import { Games } from './Games'
import { Error } from '../error/Error'
import { Loading } from '../spinner/Spinner'
import { fetchGames } from '../../modules/psnStore'

const newGamesUrl =
  'https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-GAMELATEST?sort=release_date&direction=desc&platform=ps4&game_content_type=games&size=100&bucket=games&start=0'
const sortDesc = R.sort(R.descend(R.prop('date')))

class NewGames extends React.Component {
  constructor(props) {
    super(props)

    this.state = {
      loading: true,
      error: false
    }
  }

  componentDidMount() {
    fetchGames(newGamesUrl)
      .then(sortDesc)
      .then(games => this.setState({ games, loading: false }))
      .catch(() => this.setState({ error: true }))
  }

  render() {
    const showGames = !this.state.loading && !this.state.error

    return (
      <div>
        <Error error={this.state.error} />
        <Loading loading={this.state.loading} />
        {showGames && <Games games={this.state.games} />}
      </div>
    )
  }
}

export default NewGames
