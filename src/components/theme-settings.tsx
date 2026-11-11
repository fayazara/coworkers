import { DropdownMenu } from "@cloudflare/kumo/components/dropdown"
import { Select } from "@cloudflare/kumo/components/select"
import {
  AppearanceIcon,
  CheckIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
} from "./icons"
import { Group, Row } from "./group"
import { useTheme } from "@/lib/theme-context"
import { parseThemePreference, THEME_LABELS } from "@/lib/theme"

/** A quick appearance choice in the sidebar, shared by desktop and phones. */
export function ThemeMenu() {
  const { preference, setPreference } = useTheme()
  return (
    <DropdownMenu>
      <DropdownMenu.Trigger
        render={(props) => (
          <button
            {...props}
            type="button"
            aria-label="Appearance"
            title="Appearance"
            className="icon-btn"
          >
            <AppearanceIcon size={20} />
          </button>
        )}
      />
      <DropdownMenu.Content side="top" align="end" className="min-w-40">
        <DropdownMenu.RadioGroup
          value={preference}
          onValueChange={(value) => setPreference(parseThemePreference(value))}
        >
          <DropdownMenu.Label>Appearance</DropdownMenu.Label>
          <DropdownMenu.RadioItem
            value="system"
            icon={<MonitorIcon />}
            className="gap-2"
          >
            System
            <DropdownMenu.RadioItemIndicator>
              <CheckIcon size={16} />
            </DropdownMenu.RadioItemIndicator>
          </DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem
            value="light"
            icon={<SunIcon />}
            className="gap-2"
          >
            Light
            <DropdownMenu.RadioItemIndicator>
              <CheckIcon size={16} />
            </DropdownMenu.RadioItemIndicator>
          </DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem
            value="dark"
            icon={<MoonIcon />}
            className="gap-2"
          >
            Dark
            <DropdownMenu.RadioItemIndicator>
              <CheckIcon size={16} />
            </DropdownMenu.RadioItemIndicator>
          </DropdownMenu.RadioItem>
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu>
  )
}

export function ThemeSettings() {
  const { preference, setPreference } = useTheme()
  return (
    <Group
      title="Appearance"
      hint="Saved for this browser. System follows your device automatically."
    >
      <Row label="Color mode" icon={<AppearanceIcon />}>
        <Select
          aria-label="Color mode"
          size="sm"
          value={preference}
          items={THEME_LABELS}
          onValueChange={(value) => setPreference(parseThemePreference(value))}
          className="w-32 shrink-0"
        />
      </Row>
    </Group>
  )
}
