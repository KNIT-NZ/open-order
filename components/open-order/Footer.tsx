// components/open-order/Footer.tsx
import { LaunchFooter } from "./LaunchNotice";
import styles from "./openOrder.module.css";
export function Footer() {
  return (
    <footer className={styles.footer} style={{ minWidth: 0, maxWidth: "100%", width: "100%", boxSizing: "border-box", flexWrap: "wrap", whiteSpace: "normal", overflowWrap: "anywhere" }}>
      <a
        href="https://knit.nz/"
        target="_blank"
        rel="noreferrer"
        className={styles.footerMark}
        aria-label="Visit knit.nz"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/knit-logo-horizontal-light.png"
          alt=""
          className={`${styles.footerLogo} ${styles.themeLightAsset}`}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/knit-logo-horizontal-dark.png"
          alt=""
          className={`${styles.footerLogo} ${styles.themeDarkAsset}`}
        />
      </a>
      <div className={styles.footerText} style={{ flex: "1 1 20rem", minWidth: 0, maxWidth: "100%", boxSizing: "border-box", whiteSpace: "normal", overflowWrap: "anywhere" }}>
        <LaunchFooter />
        {" · "}<a href="https://github.com/KNIT-NZ/open-order/blob/main/SECURITY.md">Security</a>
      </div>
    </footer>
  );
}
