/**
 * A provider failure message that only says the request never got a real answer: the connection
 * dropped, DNS failed, or the server 5xx'd. Adapters that only get the provider's text (no stable
 * code) classify such a failure `transient`; trying again later is the fix, not a human.
 */
export function isTransientFailureText(message: string): boolean {
  return /unable to connect|fetch failed|network error|connection (error|refused|reset|closed)|socket hang up|econn(refused|reset)|etimedout|enotfound|eai_again|\b50[0234]\b|internal server error|bad gateway|service unavailable|gateway timeout/i.test(
    message,
  )
}
