import {
  Asterisk,
  Mail,
  Bookmark,
  Inbox,
  Folder,
  FileText,
  Settings,
  Sun,
  Moon,
  Palette,
  Check,
} from "lucide-react";
import { DropdownMenu } from "./ui/dropdown-menu";
import { t } from "../lib/i18n";

export type ThemeId = "nova" | "nova-dark" | "light" | "dark";

export interface NovaRailProps {
  unified: boolean;
  folder: string;
  filter: string;
  unreadCount?: number;
  foldersOpen: boolean;
  theme: ThemeId;
  onSelectInbox: () => void;
  onSelectStarred: () => void;
  onSelectUnified: () => void;
  onToggleFolders: () => void;
  onOpenDrafts: () => void;
  onOpenSettings: () => void;
  onThemeChange: (theme: ThemeId) => void;
}

export function NovaRail({
  unified,
  folder,
  filter,
  unreadCount = 0,
  foldersOpen,
  theme,
  onSelectInbox,
  onSelectStarred,
  onSelectUnified,
  onToggleFolders,
  onOpenDrafts,
  onOpenSettings,
  onThemeChange,
}: NovaRailProps) {
  const isDark = theme === "dark" || theme === "nova-dark";
  const isInboxActive = !unified && folder === "INBOX" && filter !== "starred";
  const isStarredActive = filter === "starred";
  const isUnifiedActive = unified && filter !== "starred";

  return (
    <nav className="nova-rail" aria-label={t("收件箱")}>
      <div className="nova-rail-drag" aria-hidden="true" />
      <div className="nova-rail-top">
        <button
          type="button"
          className="nova-logo-badge"
          aria-label="MyMail Nova"
          title="MyMail Nova"
          onClick={onSelectInbox}
        >
          <Asterisk size={18} strokeWidth={2.4} />
        </button>

        <div className="nova-rail-nav">
          {/* Inbox */}
          <button
            type="button"
            className={"nova-rail-item " + (isInboxActive ? "active" : "")}
            aria-label={t("收件箱")}
            title={t("收件箱")}
            onClick={onSelectInbox}
          >
            <Mail size={17} />
            {unreadCount > 0 && <span className="badge-dot" />}
          </button>

          {/* Starred */}
          <button
            type="button"
            className={"nova-rail-item " + (isStarredActive ? "active" : "")}
            aria-label={t("星标")}
            title={t("星标")}
            onClick={onSelectStarred}
          >
            <Bookmark
              size={17}
              fill={isStarredActive ? "currentColor" : "none"}
            />
          </button>

          {/* Unified / Archive */}
          <button
            type="button"
            className={"nova-rail-item " + (isUnifiedActive ? "active" : "")}
            aria-label={t("所有收件箱")}
            title={t("所有收件箱")}
            onClick={onSelectUnified}
          >
            <Inbox size={17} />
          </button>

          {/* Folders toggle */}
          <button
            type="button"
            className={"nova-rail-item " + (foldersOpen ? "active" : "")}
            aria-label={t("更多文件夹")}
            title={t("更多文件夹")}
            onClick={onToggleFolders}
          >
            <Folder size={17} />
          </button>

          {/* Local Drafts */}
          <button
            type="button"
            className="nova-rail-item"
            aria-label={t("本地草稿")}
            title={t("本地草稿")}
            onClick={onOpenDrafts}
          >
            <FileText size={17} />
          </button>
        </div>
      </div>

      <div className="nova-rail-bottom">
        {/* Settings */}
        <button
          type="button"
          className="nova-rail-item"
          aria-label={t("账号设置")}
          title={t("账号设置")}
          onClick={onOpenSettings}
        >
          <Settings size={17} />
        </button>

        {/* Theme Menu & Switcher */}
        <DropdownMenu
          side="right"
          align="end"
          trigger={
            <button
              type="button"
              className="nova-rail-item"
              aria-label={t("切换主题")}
              title={t("切换主题")}
            >
              {isDark ? <Moon size={17} /> : <Sun size={17} />}
            </button>
          }
        >
          <div style={{ padding: "4px" }}>
            <button
              type="button"
              className="mi"
              onClick={() => onThemeChange("nova")}
            >
              <Palette size={14} />
              <span>{t("极简浅色 (Nova)")}</span>
              {theme === "nova" && (
                <Check size={14} style={{ marginLeft: "auto" }} />
              )}
            </button>
            <button
              type="button"
              className="mi"
              onClick={() => onThemeChange("nova-dark")}
            >
              <Moon size={14} />
              <span>{t("极简深色 (Nova)")}</span>
              {theme === "nova-dark" && (
                <Check size={14} style={{ marginLeft: "auto" }} />
              )}
            </button>
            <div className="msep" />
            <button
              type="button"
              className="mi"
              onClick={() => onThemeChange("light")}
            >
              <Sun size={14} />
              <span>{t("经典浅色")}</span>
              {theme === "light" && (
                <Check size={14} style={{ marginLeft: "auto" }} />
              )}
            </button>
            <button
              type="button"
              className="mi"
              onClick={() => onThemeChange("dark")}
            >
              <Moon size={14} />
              <span>{t("经典深色")}</span>
              {theme === "dark" && (
                <Check size={14} style={{ marginLeft: "auto" }} />
              )}
            </button>
          </div>
        </DropdownMenu>
      </div>
    </nav>
  );
}
