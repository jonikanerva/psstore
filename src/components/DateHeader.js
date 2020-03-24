import React from 'react'
import { DateTime } from 'luxon'

import './DateHeader.css'

const formatDate = (date) =>
  DateTime.fromISO(date).toLocaleString({
    weekday: 'long',
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  })
let lastDay = ''

const DateHeader = ({ date }) => {
  const day = formatDate(date)
  const dateChanged = lastDay !== day
  lastDay = day

  return dateChanged ? <div className="dateheader--date">{day}</div> : null
}

export default DateHeader
