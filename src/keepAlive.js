import { config } from './config.js'

// Render's free plan stops a service after 15 minutes without inbound
// requests, and the next visitor then waits up to a minute for it to start.
// Calling our own public URL every 5 minutes counts as inbound traffic, so
// the service stays up. It calls / (no database query), so Neon can still
// suspend while nobody is using the app.
const EVERY = 5 * 60 * 1000

export function startKeepAlive() {
  const url = config.keepAliveUrl
  if (!url) return

  const ping = async () => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (!response.ok) console.warn(`Keep-alive: ${url} answered ${response.status}`)
    } catch (error) {
      console.warn(`Keep-alive: could not reach ${url} (${error.message})`)
    }
  }

  // unref: never holds the process open during a shutdown.
  setInterval(ping, EVERY).unref()
  console.log(`Keep-alive: pinging ${url} every 5 minutes`)
}
