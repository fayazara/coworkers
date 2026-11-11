import { describe, expect, it } from "vitest"
import { authorizeCaller, refreshAppCaller } from "./app-access"
import type { AppCaller } from "./apps-runtime"
import type { AppAccess, AppLink } from "@/lib/types"

const access: AppAccess = { submit: ["bookings"], read: ["slots"], wake: true }
const caller: AppCaller = {
  label: "Guest",
  mode: "view",
  canMessage: false,
  token: "session",
  server: true,
}
const grant: AppLink = {
  token: "session",
  label: "Current guest",
  mode: "view",
  owner: false,
  audience: "session",
  canMessage: false,
  createdAt: 1,
  path: "/apps/example/session/",
}

describe("sharing permissions with upstream form backends", () => {
  it("keeps view-only server routes read-only", () => {
    expect(
      authorizeCaller(caller, access, {
        op: "put",
        collection: "bookings",
        item: { id: "booking" },
      })
    ).toMatchObject({ ok: false, status: 403 })
  })
  it("lets a form backend manage data without granting independent bot messaging", () => {
    const form = { ...caller, mode: "submit" as const }
    expect(
      authorizeCaller(form, access, {
        op: "put",
        collection: "bookings",
        item: { id: "booking" },
      })
    ).toMatchObject({ ok: true })
    expect(
      authorizeCaller(form, access, { op: "tell", text: "hello" })
    ).toMatchObject({ ok: false, status: 403 })
  })
  it("keeps direct form requests restricted to declared collections", () => {
    expect(
      authorizeCaller({ ...caller, mode: "submit", server: false }, access, {
        op: "list",
        collection: "bookings",
      })
    ).toMatchObject({ ok: false, status: 403 })
  })
  it("allows an explicit message permission independently of editing", () => {
    expect(
      authorizeCaller({ ...caller, canMessage: true }, access, {
        op: "tell",
        text: "hello",
      })
    ).toMatchObject({ ok: true })
  })
  it("drops revoked, unscoped, and mismatched server capabilities", () => {
    expect(refreshAppCaller(caller, null)).toBeNull()
    expect(refreshAppCaller({ ...caller, token: undefined }, grant)).toBeNull()
    expect(refreshAppCaller(caller, { ...grant, token: "other" })).toBeNull()
  })
  it("replaces cached privileges with current grant permissions", () => {
    expect(
      refreshAppCaller(
        { ...caller, owner: true, mode: "edit", canMessage: true },
        grant
      )
    ).toMatchObject({
      owner: false,
      mode: "view",
      canMessage: false,
      label: "Current guest",
      server: true,
    })
  })
})
