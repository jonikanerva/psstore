import { runServer } from './http/server.js'

// Entry point. NodeRuntime.runMain (inside runServer) installs graceful
// shutdown / interrupt handling.
runServer()
