import { describe, expect, it } from "vitest"
import { approvalLabels, humanKey, previewOf } from "./call-preview"

describe("previewOf", () => {
  it("shows an email as an email", () => {
    expect(
      previewOf("send_email", {
        to: "sam@x.com",
        subject: "Hi",
        body: "Line one.\n\nLine two.",
      })
    ).toMatchObject({
      kind: "email",
      to: ["sam@x.com"],
      subject: "Hi",
      body: "Line one.\n\nLine two.",
    })
  })

  it("names the email a reply answers from its file", () => {
    expect(
      previewOf("reply_email", {
        path: "/workspace/inbox/email/2026-11-02T07-22-20-this-is-a-test-from-fayaz/message.md",
        body: "Thanks",
      })
    ).toMatchObject({ kind: "email", inReplyTo: "This is a test from fayaz" })
  })

  it("recognises a connected app's email tool by its arguments", () => {
    expect(
      previewOf("app_tool_call", {
        tool: "tool_ab12cd_gmail_send",
        args: {
          to: ["a@x.com", { email: "b@x.com", name: "B" }],
          subject: "S",
          html: "<p>Hello</p>",
        },
      })
    ).toMatchObject({
      kind: "email",
      to: ["a@x.com", "B <b@x.com>"],
      body: "Hello",
    })
  })

  it("shows a command and a file plainly", () => {
    expect(previewOf("exec", { command: "ls -la" })).toEqual({
      kind: "command",
      command: "ls -la",
    })
    expect(
      previewOf("delete", { path: "/workspace/notes/a.md" })
    ).toMatchObject({
      kind: "file",
      verb: "Delete",
      path: "notes/a.md",
    })
  })

  it("turns a routine's schedule into words", () => {
    const preview = previewOf("schedule_routine", {
      name: "Digest",
      prompt: "Summarise",
      cron: "*/10 * * * *",
    })
    expect(preview).toMatchObject({ kind: "fields" })
    if (preview.kind === "fields") {
      expect(preview.rows[0]).toMatchObject({ label: "Name", value: "Digest" })
      expect(preview.rows[1]).toEqual({
        label: "When",
        value: "Every 10 minutes",
      })
    }
  })

  it("falls back to labeled fields, never braces", () => {
    const preview = previewOf("create_invoice", {
      customerName: "Acme",
      amount: 120,
      sendNow: true,
      lines: [{ item: "A", qty: 1 }],
      empty: "",
    })
    expect(preview).toEqual({
      kind: "fields",
      rows: [
        { label: "Customer name", value: "Acme", long: false },
        { label: "Amount", value: "120" },
        { label: "Send now", value: "Yes" },
      ],
      extra: { lines: [{ item: "A", qty: 1 }] },
    })
  })
})

describe("approvalLabels", () => {
  it("says what the button does", () => {
    expect(approvalLabels("send_email", { to: "a@b.c", body: "x" })).toEqual({
      approve: "Send",
      reject: "Don't send",
    })
    expect(approvalLabels("delete", { path: "a" }).approve).toBe("Delete")
    expect(approvalLabels("remember", { fact: "x" }).approve).toBe("Approve")
  })
})

describe("humanKey", () => {
  it("makes keys readable", () => {
    expect(humanKey("sentAt")).toBe("Sent at")
    expect(humanKey("due_date")).toBe("Due date")
    expect(humanKey("to")).toBe("To")
  })
})
