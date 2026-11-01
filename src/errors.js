export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export const badRequest = (message) => new HttpError(400, message)
export const forbidden = (message) => new HttpError(403, message)
export const notFound = (message) => new HttpError(404, message)
export const conflict = (message) => new HttpError(409, message)

// Use as `.catch(onDuplicate('...'))` to turn a unique-index violation into a 409.
export const onDuplicate = (message) => (error) => {
  throw error.code === '23505' ? conflict(message) : error
}
