import { runServer } from './http/server.js'

// Entry point. NodeRuntime.runMain (inside runServer) installs graceful
// shutdown / interrupt handling, replacing the manual app.listen + cache
// teardown of the previous Express server.
runServer()
