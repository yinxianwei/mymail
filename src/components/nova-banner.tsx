import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { t } from "../lib/i18n";

export function NovaBanner() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem("mail:nova:banner:dismissed") === "true",
  );

  useEffect(() => {
    localStorage.setItem("mail:nova:banner:dismissed", String(dismissed));
  }, [dismissed]);

  if (dismissed) return null;

  return (
    <div
      className="nova-banner-container"
      role="region"
      aria-label={t("AI 智邮助手")}
    >
      <button
        type="button"
        className="nova-banner-dismiss"
        onClick={() => setDismissed(true)}
        aria-label={t("收起横幅")}
        title={t("收起横幅")}
      >
        <X size={13} />
      </button>

      <div
        style={{
          position: "relative",
          width: "100%",
          height: "116px",
          overflow: "hidden",
        }}
      >
        <svg
          viewBox="0 0 600 140"
          preserveAspectRatio="xMidYMid slice"
          style={{ width: "100%", height: "100%", display: "block" }}
        >
          <defs>
            <linearGradient id="skyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#60a5fa" />
              <stop offset="50%" stopColor="#93c5fd" />
              <stop offset="100%" stopColor="#e0f2fe" />
            </linearGradient>
            <linearGradient id="terraceGrad" x1="0%" y1="0%" x2="100%" y2="50%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="70%" stopColor="#f1f5f9" />
              <stop offset="100%" stopColor="#e2e8f0" />
            </linearGradient>
            <linearGradient id="glassGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#bae6fd" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.6" />
            </linearGradient>
            <linearGradient id="bottomFade" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="var(--surface)" stopOpacity="0" />
              <stop offset="65%" stopColor="var(--surface)" stopOpacity="0.5" />
              <stop
                offset="100%"
                stopColor="var(--surface)"
                stopOpacity="0.95"
              />
            </linearGradient>
          </defs>

          {/* Sky background */}
          <rect width="600" height="140" fill="url(#skyGrad)" />

          {/* Soft stylized anime clouds */}
          <g fill="#ffffff" fillOpacity="0.95">
            <ellipse cx="140" cy="50" rx="75" ry="32" />
            <ellipse cx="185" cy="40" rx="55" ry="38" />
            <ellipse cx="230" cy="52" rx="60" ry="26" />
            <ellipse cx="460" cy="45" rx="70" ry="34" />
            <ellipse cx="510" cy="38" rx="60" ry="36" />
            <ellipse cx="560" cy="48" rx="50" ry="25" />
          </g>

          {/* Sunlit modern architecture */}
          <g transform="translate(320, 25)">
            {/* Upper terrace */}
            <path
              d="M 40,35 Q 120,10 200,32 L 205,46 Q 120,24 35,46 Z"
              fill="url(#terraceGrad)"
              stroke="#cbd5e1"
              strokeWidth="0.8"
            />
            {/* Glass windows */}
            <path
              d="M 45,46 Q 120,24 195,46 L 190,68 Q 120,48 48,68 Z"
              fill="url(#glassGrad)"
            />
            {/* Window mullions */}
            <line
              x1="80"
              y1="38"
              x2="82"
              y2="60"
              stroke="#ffffff"
              strokeWidth="1"
              strokeOpacity="0.7"
            />
            <line
              x1="120"
              y1="32"
              x2="120"
              y2="56"
              stroke="#ffffff"
              strokeWidth="1"
              strokeOpacity="0.7"
            />
            <line
              x1="160"
              y1="36"
              x2="158"
              y2="60"
              stroke="#ffffff"
              strokeWidth="1"
              strokeOpacity="0.7"
            />

            {/* Overhang roof */}
            <ellipse
              cx="120"
              cy="22"
              rx="85"
              ry="12"
              fill="#ffffff"
              stroke="#e2e8f0"
              strokeWidth="1"
            />

            {/* Lush greenery on the terrace roof */}
            <ellipse cx="70" cy="16" rx="28" ry="12" fill="#22c55e" />
            <ellipse cx="110" cy="14" rx="34" ry="14" fill="#16a34a" />
            <ellipse cx="150" cy="15" rx="30" ry="13" fill="#15803d" />
            <ellipse cx="130" cy="10" rx="22" ry="9" fill="#4ade80" />
            <ellipse cx="85" cy="11" rx="20" ry="8" fill="#86efac" />
          </g>

          {/* Foreground framing tree canopies */}
          <g transform="translate(0, 45)">
            <ellipse cx="10" cy="30" rx="45" ry="40" fill="#16a34a" />
            <ellipse cx="35" cy="40" rx="40" ry="35" fill="#22c55e" />
            <ellipse cx="20" cy="20" rx="30" ry="25" fill="#4ade80" />
          </g>

          {/* Right framing greenery */}
          <g transform="translate(540, 50)">
            <ellipse cx="30" cy="25" rx="50" ry="45" fill="#15803d" />
            <ellipse cx="10" cy="35" rx="35" ry="30" fill="#16a34a" />
            <ellipse cx="25" cy="15" rx="30" ry="22" fill="#4ade80" />
          </g>

          {/* Smooth bottom fade into surface */}
          <rect y="30" width="600" height="110" fill="url(#bottomFade)" />
        </svg>

        {/* Text overlay */}
        <div
          style={{
            position: "absolute",
            bottom: "16px",
            left: "20px",
            pointerEvents: "none",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
          }}
        >
          <span
            style={{
              fontSize: "16px",
              fontWeight: 700,
              color: "var(--text)",
              letterSpacing: "-0.2px",
              lineHeight: 1.25,
            }}
          >
            {t("开启 AI 智邮")}
          </span>
          <span
            style={{
              fontSize: "12px",
              fontWeight: 500,
              color: "var(--text-2)",
              letterSpacing: "-0.1px",
            }}
          >
            {t("体验新一代智能收件箱")}
          </span>
        </div>
      </div>
    </div>
  );
}
