import './Spinner.css'

const Spinner = () => (
  <div className="spinner--modal">
    <div className="spinner" />
  </div>
)

interface LoadingProps {
  loading: boolean
}

const Loading = ({ loading }: LoadingProps) =>
  loading === false ? null : <Spinner />

export default Loading
