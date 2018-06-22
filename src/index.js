import React from 'react'
import ReactDOM from 'react-dom'
import App from './components/app/App'
import registerServiceWorker from './modules/registerServiceWorker'
import './index.css'

ReactDOM.render(<App />, document.getElementById('root'))

registerServiceWorker()
