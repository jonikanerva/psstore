const R = require('ramda')
const express = require('express')
const axios = require('axios')
const app = express()
const port = 3500
const newGames =
  'https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-GAMELATEST?sort=release_date&direction=desc&platform=ps4&game_content_type=games&size=100&bucket=games&start=0'
const comingSoon =
  'https://store.playstation.com/valkyrie-api/en/FI/19/container/STORE-MSF75508-COMINGSOON?sort=release_date&direction=desc&size=100&bucket=games&start=0'
const dateFormat = dateString => {
  const date = new Date(dateString)

  return `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`
}
const storeUrl = id => `https://store.playstation.com/en-fi/product/${id}`
const sortDesc = R.sort(R.descend(R.prop('release-date')))
const sortAsc = R.sort(R.ascend(R.prop('release-date')))

const renderRows = R.compose(
  R.join(''),
  R.map(
    ({ name, 'release-date': date, 'thumbnail-url-base': url, id }) => `
    <tr class="gamerow">
      <td><img height="65px" src="${url}"></td>
      <td class="name"><a href="${storeUrl(id)}">${name}</a></td>
      <td class="date">${dateFormat(date)}</td>
    </tr>`
  )
)

const render = (newGames, upcomingGames) => `
  <html>
  <meta name=viewport content="width=device-width, initial-scale=1">
  <style>
    * {
      font-family: -apple-system, 'Helvetica Neue', Helvetica, Tahoma, Verdana, sans-serif;
    }
    table { 
      padding: 0;
      margin: 0;
      border: 0;
      border-spacing: 0;
      border-collapse: collapse;
    }
    a {
      color: inherit;
      text-decoration: none;
    }
    tr {
      text-align: left;
      vertical-align: top;
    }
    .gamerow:hover {
      background: #f0f0f0;
    }
    .name, .date {
      padding-left: 5px;
    }
    .name {
      width: 250px;
    }
    .header {
      color: red;
      font-weight: bold;
      font-size: 24px;
      padding-bottom: 20px;
      padding-top: 20px;
    }
    .parent {
      justify-content: center;
      display: flex;
      flex-wrap: wrap;
    }
    .list {
      padding-left: 15px;
      padding-right: 15px;
    }
  </style>
  <div class="parent">
    <div class="list">
      <div class="header">New</div>
      <table>${renderRows(newGames)}</table>
    </div>

    <div class="list">
      <div class="header">Upcoming</div>
      <table>${renderRows(upcomingGames)}</table>
    </div>
  </div>
  </html>`

const addId = data => {
  const id = R.prop('id', data)
  return R.assocPath(['attributes', 'id'], id, data)
}

const parseGames = R.compose(
  R.map(R.pick(['name', 'release-date', 'thumbnail-url-base', 'id'])),
  R.tap(console.log),
  R.map(R.prop('attributes')),
  R.map(addId),
  R.filter(R.propEq('type', 'game')),
  R.pathOr([], ['data', 'included'])
)

app.get('/', (req, res) => {
  Promise.all([axios.get(newGames), axios.get(comingSoon)])
    .then(([newGames, comingSoon]) => {
      const now = R.compose(
        sortDesc,
        parseGames
      )(newGames)

      const soon = R.compose(
        sortAsc,
        parseGames
      )(comingSoon)

      res.send(render(now, soon))
    })
    .catch(error => {
      console.log(error)

      res.send('an error occured ¯\\_(ツ)_/¯')
    })
})

app.listen(port, () => console.log(`App listening on port ${port}!`))
