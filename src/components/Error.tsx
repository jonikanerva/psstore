import './Error.css'

interface ErrorProps {
  message?: string
}
const Error = (props: ErrorProps) => (
  <div className="error">{props.message || 'an error occured ¯\\_(ツ)_/¯'}</div>
)

export default Error
