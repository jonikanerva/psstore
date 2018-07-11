import React, { Component } from 'react'
import { BrowserRouter as Router, Route } from 'react-router-dom'
import GamesList from '../gameslist/GamesList'
import Screenshots from '../screenshots/Screenshots'

import './App.css'

const game = {
  name: 'RESIDENT EVIL 2',
  date: '2019-01-25T00:00:00Z',
  url:
    'https://store.playstation.com/store/api/chihiro/00_09_000/container/FI/en/19/EP0102-CUSA09171_00-BH2R000000000PRE/1531245355000/image',
  id: 'EP0102-CUSA09171_00-BH2R000000000PRE',
  price: '€59,95',
  discountDate: '1975-01-01T00:00:00Z',
  screenshots: [
    'https://apollo2.dl.playstation.net/cdn/EP0102/CUSA09171_00/FREE_CONTENTZ37LEqCtcb2aQ3MIUdHP/PREVIEW_SCREENSHOT1_533482.jpg',
    'https://apollo2.dl.playstation.net/cdn/EP0102/CUSA09171_00/FREE_CONTENTHwLbq86zGaLvYi0QBCok/PREVIEW_SCREENSHOT2_533482.jpg',
    'https://apollo2.dl.playstation.net/cdn/EP0102/CUSA09171_00/FREE_CONTENTuaLTVUpUhnoBlbJXluur/PREVIEW_SCREENSHOT3_533482.jpg',
    'https://apollo2.dl.playstation.net/cdn/EP0102/CUSA09171_00/FREE_CONTENTNAf6YFelSTVkBct1gNz0/PREVIEW_SCREENSHOT4_533482.jpg',
    'https://apollo2.dl.playstation.net/cdn/EP0102/CUSA09171_00/FREE_CONTENTb9IuRSascyVqiuWYjbTG/PREVIEW_SCREENSHOT5_533482.jpg',
    'https://apollo2.dl.playstation.net/cdn/EP0102/CUSA09171_00/FREE_CONTENTFzKK0VRkEQ5RcbXdKxQm/PREVIEW_SCREENSHOT6_533482.jpg',
    'https://apollo2.dl.playstation.net/cdn/EP0102/CUSA09171_00/FREE_CONTENT7UWBDVqV5SsLVHhE4FSE/PREVIEW_SCREENSHOT7_533482.jpg',
    'https://apollo2.dl.playstation.net/cdn/EP0102/CUSA09171_00/FREE_CONTENT6sCv5yEKK1tL6Uny5rUW/PREVIEW_SCREENSHOT8_533482.jpg',
    'https://apollo2.dl.playstation.net/cdn/EP0102/CUSA09171_00/FREE_CONTENTUNcd8wTEsyLj4BL99THA/PREVIEW_SCREENSHOT9_533482.jpg',
    'https://apollo2.dl.playstation.net/cdn/EP0102/CUSA09171_00/FREE_CONTENTHiUysfKzWeBc3C8x7KWm/PREVIEW_SCREENSHOT10_533482.jpg'
  ],
  videos: [],
  genres: 'Action, Horror, Adventure',
  description:
    "<b><font color=\"orange\">PRE-ORDER – IMMEDIATE PAYMENT REQUIRED</font></b><br><br><br>Digital pre-order bonus:<br>- Deluxe Weapon: 'Samurai Edge - Chris Model'<br>- Deluxe Weapon: 'Samurai Edge - Jill Model'<br>- Resident Evil 2 Special Theme<br><br>Originally released in 1998, Resident Evil 2, one of the most iconic games of all time, returns completely reimagined for next-gen consoles.<br><br>Play individual campaigns for both Leon Kennedy and Claire Redfield using an all new 3rd person view as you explore the zombie infested areas of Raccoon City, now stunningly re-built using Capcom’s proprietary RE Engine. New puzzles, storylines and areas mean both new and seasoned fans will find horrifying new surprises await them!<br><br>In-game purchases optional<br><br>For more information on pre-ordering, including how to cancel your pre-order, see the Sony Entertainment Network Terms of Service/User Agreement. Auto-download requires Automatic Login and Auto Sign-In to be enabled on your PS4™ system.<br><br>1 Player<br>DUALSHOCK®4 Vibration Function<br>Remote Play Supported<br>HD Video Output 720p, 1080i, 1080p<br>In-game purchases optional<br><br>Download of this product is subject to the PlayStation Network Terms of Service and our Software Usage Terms plus any specific additional conditions applying to this product. If you do not wish to accept these terms, do not download this product. See Terms of Service for more important information.<br> One-time licence fee to download to multiple PS4 systems. Sign in to PlayStation Network is not required to use this on your primary PS4, but is required for use on other PS4 systems.<br>See Health Warnings for important health information before using this product.<br />Library programs ©Sony Interactive Entertainment Inc. exclusively licensed to Sony Interactive Entertainment Europe. Software Usage Terms apply, See eu.playstation.com/legal for full usage rights.<br><br>©CAPCOM CO., LTD. ALL RIGHTS RESERVED.",
  studio: 'CE EUROPE LIMITED'
}

class App extends Component {
  findGameAndRenderScreenshots = ({ match }) => {
    const gameId = match.params.gameId
    console.log('game ID', gameId)

    return <Screenshots game={game} show={true} />
  }

  render() {
    return (
      <Router>
        <div>
          <Route exact={true} path="/" component={GamesList} />
          <Route path="/g/:gameId" render={this.findGameAndRenderScreenshots} />
        </div>
      </Router>
    )
  }
}

export default App
