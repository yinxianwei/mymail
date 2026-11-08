import { ChoiceSelect } from "./ui/choice-select";
import { useState } from "react";
import { MailService as api } from "../mygo";
import {
  getLanguagePreference,
  setLanguagePreference,
  t,
  useLocale,
} from "../lib/i18n";

export function LanguagePreferences() {
  useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function change(preference: string) {
    setBusy(true);
    setError("");
    try {
      const language = await api.setLanguage(preference);
      setLanguagePreference(language.preference, language.locale);
    } catch {
      setError("语言设置保存失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mail-preferences" aria-label={t("界面语言")}>
      <div className="pref-row">
        <label htmlFor="pref-language">{t("语言")}</label>
        <ChoiceSelect
          id="pref-language"
          className="pref-select"
          value={getLanguagePreference()}
          disabled={busy}
          onValueChange={(value) => void change(value)}
          options={[
            { value: "system", label: t("跟随系统") },
            { value: "zh-CN", label: "简体中文" },
            { value: "en", label: "English" },
          ]}
        />
      </div>
      {error && (
        <p className="form-error" role="alert">
          {t(error)}
        </p>
      )}
    </section>
  );
}
