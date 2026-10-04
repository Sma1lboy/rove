import { mkdtempSync } from "node:fs"
import { type Server, type Socket, createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import { RoveSocket } from "../src/socket.ts"

const clients: RoveSocket[] = []
const sockets: Socket[] = []
const servers: Server[] = []

async function connect(onData: (socket: Socket, data: string) => void, client = new RoveSocket()) {
  const path = join(mkdtempSync(join(tmpdir(), "rove-sdk-lifecycle-")), "d.sock")
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.push(socket)
    socket.setEncoding("utf8")
    socket.on("data", (data: string) => onData(socket, data))
  })
  servers.push(server)
  clients.push(client)
  await new Promise<void>((resolve) => server.listen(path, resolve))
  await client.connect({ socketPath: path })
  return client
}

function outcome(promise: Promise<unknown>) {
  return promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  )
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.close()
  for (const socket of sockets.splice(0)) socket.destroy()
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

it("rejects pending requests immediately on close without waiting for a half-open peer", async () => {
  const received = vi.fn()
  const client = await connect(received)
  const closed = vi.fn()
  client.onClose(closed)
  const settled = vi.fn()
  void outcome(client.request("waiting")).then(settled)
  await vi.waitFor(() => expect(received).toHaveBeenCalledOnce())
  client.close()
  await vi.waitFor(() => expect(settled).toHaveBeenCalledWith({ error: expect.any(Error) }), { timeout: 200 })
  expect(closed).not.toHaveBeenCalled()
})

it("rejects new requests after the daemon disconnects", async () => {
  const client = await connect((socket) => socket.destroy())
  const closed = vi.fn()
  client.onClose(closed)
  await expect(client.request("disconnect")).rejects.toThrow()
  await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce())
  const settled = vi.fn()
  void outcome(client.request("too-late")).then(settled)
  await vi.waitFor(() => expect(settled).toHaveBeenCalledWith({ error: expect.any(Error) }), { timeout: 200 })
})

it("ignores invalid frame shapes and keeps reading valid responses and events", async () => {
  const invalid = [null, 42, "text", true, [], {}, { type: "event" }, { type: "response", id: 1 }]
  const client = await connect((socket, data) => {
    const { id } = JSON.parse(data)
    socket.write(`${invalid.map((frame) => JSON.stringify(frame)).join("\n")}\n`)
    socket.write(`${JSON.stringify({ type: "response", id, error: {} })}\n`)
    socket.write(`${JSON.stringify({ type: "response", id, payload: "ok" })}\n`)
    socket.write(`${JSON.stringify({ type: "event", name: "task.snapshot", payload: 7 })}\n`)
  })
  const event = vi.fn()
  await client.subscribe(event)
  await vi.waitFor(() => expect(event).toHaveBeenCalledWith("task.snapshot", 7))
  expect(await client.request("read")).toBe("ok")
})

it("keeps a replacement connection alive when the previous socket closes late", async () => {
  const firstReceived = vi.fn()
  const client = await connect(firstReceived)
  const settled = vi.fn()
  void outcome(client.request("old")).then(settled)
  await vi.waitFor(() => expect(firstReceived).toHaveBeenCalledOnce())
  const oldSocket = sockets[0]
  if (!oldSocket) throw new Error("expected the first connection")
  client.close()
  await connect((socket, data) => {
    const { id } = JSON.parse(data)
    oldSocket.destroy()
    setImmediate(() => socket.write(`${JSON.stringify({ type: "response", id, payload: "new" })}\n`))
  }, client)
  const closed = vi.fn()
  client.onClose(closed)
  expect(await client.request("new")).toBe("new")
  expect(settled).toHaveBeenCalledWith({ error: expect.any(Error) })
  expect(closed).not.toHaveBeenCalled()
})

it("rejects a connection closed before its handshake completes", async () => {
  const client = await connect(() => {})
  const path = servers[0]?.address()
  if (typeof path !== "string") throw new Error("expected a Unix socket")
  client.close()
  const connecting = client.connect({ socketPath: path })
  client.close()
  await expect(connecting).rejects.toThrow("closed")
})

it("notifies once for each connection lost after reconnecting the same client", async () => {
  const client = await connect((socket) => socket.destroy())
  const closed = vi.fn()
  client.onClose(closed)
  await expect(client.request("first")).rejects.toThrow()
  await connect((socket) => socket.destroy(), client)
  await expect(client.request("second")).rejects.toThrow()
  expect(closed).toHaveBeenCalledTimes(2)
})

it("replaces an existing connection and rejects its pending requests", async () => {
  const received = vi.fn()
  const client = await connect(received)
  const pending = outcome(client.request("old"))
  await vi.waitFor(() => expect(received).toHaveBeenCalledOnce())
  await connect((socket, data) => {
    const { id } = JSON.parse(data)
    socket.write(`${JSON.stringify({ type: "response", id, payload: "replacement" })}\n`)
  }, client)
  expect(await client.request("new")).toBe("replacement")
  expect(await pending).toEqual({ error: expect.any(Error) })
})
