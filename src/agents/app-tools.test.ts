import { describe, expect, it } from "vitest"
import { appToolName, isReadOnlyTool } from "./app-tools"

describe("isReadOnlyTool", () => {
  it.each([
    ["list_messages", true],
    ["get_issue", true],
    ["search-files", true],
    ["notion.query_database", true],
    ["send_email", false],
    ["create_issue", false],
    ["find_and_replace", false],
    ["get_or_add_label", false],
    ["fetch_and_mark_read", false],
    ["query_and_insert", false],
    ["list_and_archive", false],
    ["upload_file", false],
    ["sync_contacts", false],
    // No verb it knows: not read-only.
    ["gmail", false],
    // Verbs only count as whole words.
    ["get_starred", true],
    ["reader_status", false],
  ])("guesses %s from its name: %s", (name, readOnly) => {
    expect(isReadOnlyTool(name)).toBe(readOnly)
  })

  it("trusts the server's annotations over the name", () => {
    expect(isReadOnlyTool("send_email", { readOnlyHint: true })).toBe(true)
    expect(isReadOnlyTool("list_messages", { readOnlyHint: false })).toBe(false)
  })

  it("never treats a destructive tool as read-only", () => {
    expect(isReadOnlyTool("list_messages", { destructiveHint: true })).toBe(
      false
    )
    expect(
      isReadOnlyTool("get_issue", { readOnlyHint: true, destructiveHint: true })
    ).toBe(false)
  })
})

describe("appToolName", () => {
  it("leaves a name that fits as it is", () => {
    expect(appToolName("ab12cd34", "list_messages")).toBe(
      "tool_cab12cd34_list_messages"
    )
  })

  it("stays within 64 allowed characters", () => {
    const name = appToolName("ab12cd34", `do.${"x".repeat(100)}`)
    expect(name.length).toBeLessThanOrEqual(64)
    expect(name).toMatch(/^[a-zA-Z0-9_-]+$/)
  })

  it("keeps tools apart when cleaning would merge them", () => {
    expect(appToolName("ab12cd34", "issues.list")).not.toBe(
      appToolName("ab12cd34", "issues_list")
    )
  })

  it("keeps tools apart when cutting would merge them", () => {
    const long = "list_all_messages_in_the_shared_inbox_with_labels"
    expect(appToolName("ab12cd34", `${long}_read`)).not.toBe(
      appToolName("ab12cd34", `${long}_delete`)
    )
  })

  it("gives the same tool the same name every time", () => {
    const name = `${"y".repeat(80)}.z`
    expect(appToolName("ab12cd34", name)).toBe(appToolName("ab12cd34", name))
  })
})
