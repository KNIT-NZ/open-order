// components/open-order/Hero.tsx
import styles from "./openOrder.module.css";
import type { ThemeMode } from "../../lib/open-order/types";

type HeroProps = {
  theme: ThemeMode;
  onToggleTheme: () => void;
};

export function Hero({ theme, onToggleTheme }: HeroProps) {
  return (
    <div className={styles.heroTop}>
      <div className={styles.brand}>
        <h1 className={styles.visuallyHidden}>Open Order</h1>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={
            theme === "dark"
              ? "/open-order-logo-dark.png"
              : "/open-order-logo-light.png"
          }
          alt="Open Order"
          width={220}
          height={96}
          className={styles.logo}
          fetchPriority="high"
        />
        <p className={styles.subtitle}>
          <span className={styles.subtitleLineLight}>
            Procedural navigator for the
          </span>
          <span className={styles.subtitleLineStrong}>
            NZ House of Representatives
          </span>
        </p>
      </div>

      <button
        type="button"
        className={styles.themeToggle}
        onClick={onToggleTheme}
        aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
        title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
      >
        <svg
          className={styles.themeToggleIcon}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            cx="12"
            cy="12"
            r="8.5"
            className={styles.themeToggleCircle}
          />
          <path
            d="M12 3.5A8.5 8.5 0 0 1 12 20.5Z"
            className={styles.themeToggleHalf}
          />
        </svg>
      </button>
    </div>
  );
}
