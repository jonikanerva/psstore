interface ErrorProps {
  message?: string
}
const Error = (props: ErrorProps) => (
  <div className="error">
    {props.message || 'Something went wrong. Try again later.'}
  </div>
)

export default Error
