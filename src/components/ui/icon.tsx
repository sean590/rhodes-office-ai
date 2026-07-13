/**
 * Icon — thin wrapper over @tabler/icons-react keyed by the prototype's `ti-*`
 * names (the UX-refresh visual source of truth). Lets components write
 * <Icon name="send" /> instead of importing each Tabler component, and gives one
 * place to swap the icon set. Explicit imports below tree-shake.
 *
 * The legacy hand-rolled set in ui/icons.tsx still works; callers migrate to
 * <Icon> incrementally.
 */

import {
  IconHome, IconBuilding, IconBuildingEstate, IconChartBar, IconChartPie,
  IconFileText, IconFiles, IconFileImport, IconChecklist, IconUsers, IconUser,
  IconUserPlus, IconUserCog, IconUserCheck, IconSettings, IconSearch, IconBell,
  IconMessage, IconSparkles, IconLayoutSidebar, IconPlus, IconChevronDown,
  IconChevronRight, IconPencil, IconX, IconCheck, IconCircleCheck, IconFolder,
  IconAlertTriangle, IconHelpCircle, IconInfoCircle, IconClock, IconSend,
  IconRefresh, IconLoader2, IconInbox, IconExternalLink, IconDots,
  IconDotsVertical, IconArrowLeft, IconArrowRight, IconArrowDownLeft, IconMail,
  IconEye, IconAffiliate, IconWand, IconUpload, IconDownload, IconShield,
  IconTrash, IconMenu2, IconScale, IconBriefcase,
  type IconProps as TablerIconProps,
} from "@tabler/icons-react";

const MAP = {
  home: IconHome,
  building: IconBuilding,
  "building-estate": IconBuildingEstate,
  "chart-bar": IconChartBar,
  "chart-pie": IconChartPie,
  "file-text": IconFileText,
  files: IconFiles,
  "file-import": IconFileImport,
  checklist: IconChecklist,
  users: IconUsers,
  user: IconUser,
  "user-plus": IconUserPlus,
  "user-cog": IconUserCog,
  "user-check": IconUserCheck,
  settings: IconSettings,
  search: IconSearch,
  bell: IconBell,
  message: IconMessage,
  sparkles: IconSparkles,
  "layout-sidebar": IconLayoutSidebar,
  plus: IconPlus,
  "chevron-down": IconChevronDown,
  "chevron-right": IconChevronRight,
  pencil: IconPencil,
  x: IconX,
  check: IconCheck,
  "circle-check": IconCircleCheck,
  folder: IconFolder,
  "alert-triangle": IconAlertTriangle,
  "help-circle": IconHelpCircle,
  "info-circle": IconInfoCircle,
  clock: IconClock,
  send: IconSend,
  refresh: IconRefresh,
  "loader-2": IconLoader2,
  inbox: IconInbox,
  "external-link": IconExternalLink,
  dots: IconDots,
  "dots-vertical": IconDotsVertical,
  "arrow-left": IconArrowLeft,
  "arrow-right": IconArrowRight,
  "arrow-down-left": IconArrowDownLeft,
  mail: IconMail,
  eye: IconEye,
  affiliate: IconAffiliate,
  wand: IconWand,
  upload: IconUpload,
  download: IconDownload,
  shield: IconShield,
  trash: IconTrash,
  "menu-2": IconMenu2,
  scale: IconScale,
  briefcase: IconBriefcase,
} as const;

export type IconName = keyof typeof MAP;

export interface IconProps extends Omit<TablerIconProps, "ref"> {
  name: IconName;
}

export function Icon({ name, size = 18, stroke = 1.7, ...rest }: IconProps) {
  const Cmp = MAP[name];
  if (!Cmp) return null;
  return <Cmp size={size} stroke={stroke} {...rest} />;
}
