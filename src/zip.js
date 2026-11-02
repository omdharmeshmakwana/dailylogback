import { deflateRawSync } from 'node:zlib'

// Minimal .zip writer (deflate, no zip64): enough for a handful of CSV files.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// files: [{ name, content }]. modified is read with UTC getters, so pass a
// Date whose UTC fields hold the local wall-clock time (zip has no timezone).
export function zip(files, modified = new Date()) {
  const time = (modified.getUTCHours() << 11) | (modified.getUTCMinutes() << 5) | (modified.getUTCSeconds() >> 1)
  const date = ((modified.getUTCFullYear() - 1980) << 9) | ((modified.getUTCMonth() + 1) << 5) | modified.getUTCDate()
  const locals = []
  const centrals = []
  let offset = 0

  for (const file of files) {
    const name = Buffer.from(file.name)
    const raw = Buffer.from(file.content)
    const data = deflateRawSync(raw)
    // Shared by the local and central headers: version 2.0, UTF-8 names, deflate.
    const fields = Buffer.alloc(26)
    fields.writeUInt16LE(20, 0)
    fields.writeUInt16LE(0x0800, 2)
    fields.writeUInt16LE(8, 4)
    fields.writeUInt16LE(time, 6)
    fields.writeUInt16LE(date, 8)
    fields.writeUInt32LE(crc32(raw), 10)
    fields.writeUInt32LE(data.length, 14)
    fields.writeUInt32LE(raw.length, 18)
    fields.writeUInt16LE(name.length, 22)

    const local = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), fields, name, data])
    // Comment length, disk, attributes, then where the local header starts.
    const tail = Buffer.alloc(14)
    tail.writeUInt32LE(offset, 10)
    centrals.push(Buffer.concat([Buffer.from([0x50, 0x4b, 0x01, 0x02, 20, 0]), fields, tail, name]))
    locals.push(local)
    offset += local.length
  }

  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
