// components/open-order/Footer.tsx
import styles from "./openOrder.module.css";
import type { ThemeMode } from "../../lib/open-order/types";

type FooterProps = {
  theme: ThemeMode;
};

export function Footer({ theme }: FooterProps) {
  return (
    <footer className={styles.footer}>
      <a
        href="https://knit.nz/"
        target="_blank"
        rel="noreferrer"
        className={styles.footerMark}
        aria-label="Visit knit.nz"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={
            theme === "dark"
              ? "/knit-logo-horizontal-dark.png"
              : "/knit-logo-horizontal-light.png"
          }
          alt=""
          className={styles.footerLogo}
        />
      </a>
      <div className={styles.footerText}>
        Open Order is an experimental civics app developed by knit.
      </div>
    </footer>
  );
}
