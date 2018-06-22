import React from 'react'
import './Games.css'

const storeUrl = id => `https://store.playstation.com/en-fi/product/${id}`
const dateFormat = dateString => {
  const date = new Date(dateString)

  return `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`
}

const Rows = props =>
  props.games.map(({ name, date, url, id }) => (
    <tr key={id} className="gamerow">
      <td>
        <img height="65px" src={url} alt={name} />
      </td>
      <td className="name">
        <a href={storeUrl(id)}>{name}</a>
      </td>
      <td className="date">{dateFormat(date)}</td>
    </tr>
  ))

export const Games = props => (
  <table>
    <Rows games={props.games} />
  </table>
)
