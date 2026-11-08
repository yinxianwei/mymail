import { useState, type ReactNode } from "react";
import { Settings, Mail, Inbox, Database } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { t, useLocale } from "../lib/i18n";

type Section = "general" | "accounts" | "mail" | "storage";

export function SettingsSections({
  general,
  accounts,
  mail,
  storage,
  initialSection = "general",
}: Record<Section, ReactNode> & { initialSection?: Section }) {
  useLocale();
  const [active, setActive] = useState<string>(initialSection);
  const sections = [
    { value: "general", label: t("通用"), icon: Settings, content: general },
    { value: "accounts", label: t("邮箱账号"), icon: Inbox, content: accounts },
    { value: "mail", label: t("邮件"), icon: Mail, content: mail },
    {
      value: "storage",
      label: t("存储与诊断"),
      icon: Database,
      content: storage,
    },
  ];
  return (
    <Tabs
      orientation="vertical"
      value={active}
      onValueChange={setActive}
      className="settings-tabs"
    >
      <TabsList aria-label={t("设置分类")} className="settings-navigation">
        {sections.map(({ value, label, icon: Icon }) => (
          <TabsTrigger key={value} value={value}>
            <Icon />
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      {sections.map(({ value, label, content }) => (
        <TabsContent
          forceMount
          hidden={active !== value}
          key={value}
          value={value}
          className="settings-content"
        >
          <h3>{label}</h3>
          {content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
