import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon as Add,
  Alert02Icon as Alert,
  AppWindowIcon as AppWindow,
  ArrowDown01Icon as ChevronDown,
  ArrowLeft02Icon as ArrowLeft,
  ArrowRight01Icon as ChevronRight,
  ArrowRight02Icon as ArrowRight,
  ArrowUp02Icon as ArrowUp,
  Attachment01Icon as Attachment,
  BookOpen01Icon as BookOpen,
  BotIcon as Bot,
  Cancel01Icon as Cancel,
  Clock01Icon as Clock,
  ComputerTerminal01Icon as Terminal,
  Copy01Icon as Copy,
  AiBrowserIcon as AiBrowser,
  Delete02Icon as Delete,
  Brain02Icon as Brain,
  Calendar03Icon as Calendar,
  FileEditIcon as FileEdit,
  Message01Icon as Message,
  LaptopIcon as Laptop,
  MoonIcon as Moon,
  Download04Icon as Download,
  AlignBoxTopLeftIcon as File,
  FileZipIcon as FileZip,
  Globe02Icon as Globe,
  Image01Icon as Image,
  InboxCheckIcon as InboxCheck,
  InboxIcon as Inbox,
  LockIcon as Lock,
  Pdf01Icon as Pdf,
  WebDesign01Icon as WebDesign,
  LeftToRightListBulletIcon as ListBullet,
  LinkSquare02Icon as LinkSquare,
  Mail01Icon as Mail,
  Notification01Icon as Notification,
  Notification03Icon as NotificationRinging,
  NotificationOff01Icon as NotificationOff,
  Plug01Icon as Plug,
  PowerIcon as Power,
  Refresh01Icon as Refresh,
  RepeatIcon as Repeat,
  Search01Icon as Search,
  SearchList02Icon as SearchList,
  Settings03Icon as Settings,
  PanelLeft as SidebarLeft,
  StopIcon as Stop,
  Sun01Icon as Sun,
  TeachingIcon as Teaching,
  Tick02Icon as Tick,
  ViewIcon as View,
  WebhookIcon as Webhook,
  WorkflowIcon as Workflow,
  PlayIcon as Play,
} from "@hugeicons/core-free-icons"
import type { HugeiconsProps, IconSvgElement } from "@hugeicons/react"

export type IconProps = Omit<HugeiconsProps, "icon" | "ref">

/**
 * Every icon in the app comes from Hugeicons (rounded strokes to match the
 * rounded UI). Icons default to 1em so they follow the surrounding text and
 * Kumo's button sizing.
 *
 * Strokes are a true 1.5px on screen at every size (see `.hi` in
 * styles.css). Hugeicons draw 1.5 on a 24px grid, so a 16px icon would
 * otherwise get a 1px hairline and a 20px one 1.25px.
 */
function icon(svg: IconSvgElement, name: string) {
  function Icon({ size = "1em", className = "", ...props }: IconProps) {
    return (
      <HugeiconsIcon
        icon={svg}
        size={size}
        className={`hi ${className}`}
        {...props}
      />
    )
  }
  Icon.displayName = name
  return Icon
}

export const AppWindowIcon = icon(AppWindow, "AppWindowIcon")
export const ArrowClockwiseIcon = icon(Refresh, "ArrowClockwiseIcon")
export const ArrowLeftIcon = icon(ArrowLeft, "ArrowLeftIcon")
export const ArrowRightIcon = icon(ArrowRight, "ArrowRightIcon")
export const ArrowSquareOutIcon = icon(LinkSquare, "ArrowSquareOutIcon")
export const ArrowUpIcon = icon(ArrowUp, "ArrowUpIcon")
export const ArrowsClockwiseIcon = icon(Repeat, "ArrowsClockwiseIcon")
export const BellIcon = icon(Notification, "BellIcon")
export const BellRingingIcon = icon(NotificationRinging, "BellRingingIcon")
export const BellSlashIcon = icon(NotificationOff, "BellSlashIcon")
export const BrainIcon = icon(Brain, "BrainIcon")
export const CalendarIcon = icon(Calendar, "CalendarIcon")
export const BotIcon = icon(Bot, "BotIcon")
export const BookOpenTextIcon = icon(BookOpen, "BookOpenTextIcon")
export const CaretDownIcon = icon(ChevronDown, "CaretDownIcon")
export const CaretRightIcon = icon(ChevronRight, "CaretRightIcon")
export const ChalkboardTeacherIcon = icon(Teaching, "ChalkboardTeacherIcon")
export const CheckIcon = icon(Tick, "CheckIcon")
export const ClockIcon = icon(Clock, "ClockIcon")
export const CopyIcon = icon(Copy, "CopyIcon")
export const DownloadIcon = icon(Download, "DownloadIcon")
export const FileEditIcon = icon(FileEdit, "FileEditIcon")
export const FileIcon = icon(File, "FileIcon")
export const FilePdfIcon = icon(Pdf, "FilePdfIcon")
export const FileZipIcon = icon(FileZip, "FileZipIcon")
export const CrawlIcon = icon(WebDesign, "CrawlIcon")
export const EnvelopeSimpleIcon = icon(Mail, "EnvelopeSimpleIcon")
export const EyeIcon = icon(View, "EyeIcon")
export const GearSixIcon = icon(Settings, "GearSixIcon")
export const GlobeIcon = icon(Globe, "GlobeIcon")
export const ImageIcon = icon(Image, "ImageIcon")
export const InboxIcon = icon(Inbox, "InboxIcon")
export const InboxCheckIcon = icon(InboxCheck, "InboxCheckIcon")
export const LockIcon = icon(Lock, "LockIcon")
export const ListBulletsIcon = icon(ListBullet, "ListBulletsIcon")
export const MessageIcon = icon(Message, "MessageIcon")
export const MagnifyingGlassIcon = icon(Search, "MagnifyingGlassIcon")
export const SearchListIcon = icon(SearchList, "SearchListIcon")
export const MoonIcon = icon(Moon, "MoonIcon")
export const LaptopIcon = icon(Laptop, "LaptopIcon")
export const ComputerIcon = icon(AiBrowser, "ComputerIcon")
export const PaperclipIcon = icon(Attachment, "PaperclipIcon")
export const PlugsConnectedIcon = icon(Plug, "PlugsConnectedIcon")
export const PipelineIcon = icon(Workflow, "PipelineIcon")
export const PlayIcon = icon(Play, "PlayIcon")
export const PlusIcon = icon(Add, "PlusIcon")
export const PowerIcon = icon(Power, "PowerIcon")
export const SidebarSimpleIcon = icon(SidebarLeft, "SidebarSimpleIcon")
export const StopIcon = icon(Stop, "StopIcon")
export const SunIcon = icon(Sun, "SunIcon")
export const TerminalIcon = icon(Terminal, "TerminalIcon")
export const TrashIcon = icon(Delete, "TrashIcon")
export const WarningIcon = icon(Alert, "WarningIcon")
export const WebhooksLogoIcon = icon(Webhook, "WebhooksLogoIcon")
export const XIcon = icon(Cancel, "XIcon")
