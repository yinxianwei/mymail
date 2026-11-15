import { Sparkles } from "lucide-react";
import { t } from "../lib/i18n";

export function NovaAiCard({ onAction }: { onAction?: () => void }) {
  // 24 capacity bars matching the screenshot's quota visualizer
  const bars = Array.from({ length: 24 });

  return (
    <div
      className="nova-ai-card"
      role="status"
      aria-label={t("AI 智邮助手")}
      onClick={onAction}
      style={{ cursor: onAction ? "pointer" : "default" }}
    >
      <div className="nova-ai-info">
        <div className="nova-ai-icon-box">
          <Sparkles size={16} />
        </div>
        <div className="nova-ai-texts">
          <span className="nova-ai-title">GPT 5.5</span>
          <span className="nova-ai-sub">
            Pro (20x) · {t("智能分类与摘要已就绪")}
          </span>
        </div>
      </div>

      <div className="nova-ai-bars" aria-hidden="true" title="AI Pro (20x)">
        {bars.map((_, i) => (
          <span
            key={i}
            className="nova-ai-bar"
            style={{
              opacity: i > 20 ? 0.35 : 0.9,
              height: `${14 + ((i * 7) % 7)}px`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
