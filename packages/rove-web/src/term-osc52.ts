/**
 * The text an OSC 52 clipboard write carries (`<targets>;<base64>`): how a program that draws its own
 * selection (an engine with mouse reporting on) copies. A read request (`?`) or a payload that is not
 * base64 UTF-8 is null: the page never hands its clipboard to the terminal.
 */
export function osc52Text(data: string): string | null {
  const payload = data.slice(data.indexOf(";") + 1)
  if (!data.includes(";") || payload === "?" || payload === "") return null
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(payload), (c) => c.charCodeAt(0)))
  } catch {
    return null
  }
}
