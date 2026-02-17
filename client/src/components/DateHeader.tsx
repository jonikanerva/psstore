import { DateTime } from 'luxon'
import './DateHeader.css'

const formatDate = (date: string): string =>
  DateTime.fromISO(date).toLocaleString({
    weekday: 'long',
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  }) || ''

const DateHeader = ({ date }: { date: string }) => (
  <div className="dateheader--date">{formatDate(date)}</div>
)

export default DateHeader
