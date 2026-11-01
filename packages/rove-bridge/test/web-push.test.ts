import { describe, expect, test } from "bun:test"
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from "node:crypto"
import {
  b64url,
  encryptPayload,
  fromB64url,
  generateVapidKeys,
  isPushEndpoint,
  vapidAuthorization,
} from "../src/web-push.ts"

describe("encryptPayload", () => {
  test("reproduces RFC 8291 Appendix A byte for byte", () => {
    const body = encryptPayload(
      Buffer.from("When I grow up, I want to be a watermelon"),
      {
        p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        auth: "BTBZMqHH6r4Tts7J_aSIgg",
      },
      {
        salt: fromB64url("DGv6ra1nlYgDCS1FRnbzlw"),
        serverPrivateKey: fromB64url("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
      },
    )
    expect(b64url(body)).toBe(
      // The request body of RFC 8291 §5, whose intermediates Appendix A lists.
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
        "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    )
  })

  test("a subscriber holding its private key decrypts a fresh message", () => {
    const ua = createECDH("prime256v1")
    ua.generateKeys()
    const auth = Buffer.alloc(16, 7)
    const body = encryptPayload(Buffer.from('{"taskId":"t1"}'), {
      p256dh: b64url(ua.getPublicKey()),
      auth: b64url(auth),
    })
    const salt = body.subarray(0, 16)
    const asPublic = body.subarray(21, 86)
    const ikm = Buffer.from(
      hkdfSync(
        "sha256",
        ua.computeSecret(asPublic),
        auth,
        Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPublic]),
        32,
      ),
    )
    const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16))
    const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12))
    const sealed = body.subarray(86)
    const decipher = createDecipheriv("aes-128-gcm", cek, nonce)
    decipher.setAuthTag(sealed.subarray(sealed.length - 16))
    const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()])
    expect(plain.toString()).toBe('{"taskId":"t1"}\u0002')
  })
})

describe("vapidAuthorization", () => {
  test("signs a token for the endpoint's origin that the VAPID public key verifies", () => {
    const keys = generateVapidKeys()
    const header = vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", keys, 1_000_000_000_000)
    const [, token = "", k = ""] = header.match(/^vapid t=([^,]+), k=(.+)$/) ?? []
    expect(k).toBe(keys.publicKey)
    const [h = "", c = "", s = ""] = token.split(".")
    const claims = JSON.parse(fromB64url(c).toString())
    expect(claims.aud).toBe("https://fcm.googleapis.com")
    expect(claims.exp - 1_000_000_000).toBeLessThanOrEqual(24 * 60 * 60)
    const pub = fromB64url(keys.publicKey)
    const key = createPublicKey({
      format: "jwk",
      key: { kty: "EC", crv: "P-256", x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33)) },
    })
    expect(verify("sha256", Buffer.from(`${h}.${c}`), { key, dsaEncoding: "ieee-p1363" }, fromB64url(s))).toBe(true)
  })
})

describe("isPushEndpoint", () => {
  test("accepts the browsers' push services over https", () => {
    for (const ok of [
      "https://fcm.googleapis.com/fcm/send/x",
      "https://web.push.apple.com/QO",
      "https://updates.push.services.mozilla.com/wpush/v2/x",
      "https://wns2-par02p.notify.windows.com/w/?token=x",
    ])
      expect(isPushEndpoint(ok)).toBe(true)
  })

  test("refuses anything the bridge should not POST to", () => {
    for (const bad of [
      "http://fcm.googleapis.com/fcm/send/x",
      "https://fcm.googleapis.com:8443/x",
      "https://evilfcm.googleapis.com.example/x",
      "https://push.apple.com.evil.example/x",
      "https://user@fcm.googleapis.com/x",
      "https://127.0.0.1/x",
      "not a url",
    ])
      expect(isPushEndpoint(bad)).toBe(false)
  })
})
