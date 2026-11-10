import { expect, test } from "bun:test"
import { configuredAs, modelRepoDir, withoutCloud } from "../src/ops/voice-setup.ts"

const cloud = { backend: "cloud", baseURL: "https://api.example.com/v1", model: "whisper-1", apiKey: "sk-1" } as const

test("turning dictation off or local keeps the cloud endpoint, and picking cloud again needs nothing retyped", () => {
  const off = configuredAs(cloud, { backend: "off" })
  // `model` at the top level is the local model's name once cloud is not in use.
  expect(off).toEqual({
    backend: "off",
    apiKey: "sk-1",
    cloudSaved: { baseURL: "https://api.example.com/v1", model: "whisper-1" },
  })
  const local = configuredAs(off, { backend: "local" })
  expect(local.backend).toBe("local")
  expect(configuredAs(local, { backend: "cloud" })).toEqual(cloud)
})

test("cloud is refused without an endpoint or a key", () => {
  expect(() => configuredAs({}, { backend: "cloud" })).toThrow("baseURL")
  expect(() => configuredAs({}, { backend: "cloud", baseURL: "https://x.example", model: "m" })).toThrow("apiKey")
  expect(() => configuredAs({}, { backend: "somewhere" })).toThrow("off, local or cloud")
})

test("forgetting the cloud endpoint drops the key, and turns dictation off only if cloud was in use", () => {
  expect(withoutCloud(cloud)).toEqual({ backend: "off" })
  expect(withoutCloud(configuredAs(cloud, { backend: "local" }))).toEqual({ backend: "local" })
})

test("uninstall only ever points at a Hugging Face model repo", () => {
  const hub = "/Users/me/.cache/huggingface/hub"
  expect(modelRepoDir(`${hub}/models--mlx-community--whisper-large-v3-mlx/snapshots/49e6aa2`)).toBe(
    `${hub}/models--mlx-community--whisper-large-v3-mlx`,
  )
  expect(modelRepoDir("/Users/me/Documents/snapshots/49e6aa2")).toBeNull()
  expect(modelRepoDir("/Users/me/models--x/snapshots/49e6aa2")).toBeNull()
  expect(modelRepoDir(`${hub}/models--x`)).toBeNull()
  expect(modelRepoDir("/")).toBeNull()
  expect(modelRepoDir(undefined)).toBeNull()
})
