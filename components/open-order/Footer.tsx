// components/open-order/Footer.tsx
import { LaunchPrivacyNotice } from "./LaunchNotice";
import styles from "./openOrder.module.css";
export function Footer() {
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
      <div className={styles.footerText}>
        <LaunchPrivacyNotice />
        {" "}<a href="https://github.com/KNIT-NZ/open-order">Source code</a>
        {" · "}<a href="https://github.com/KNIT-NZ/open-order/issues">Feedback</a>
        {" · "}<a href="https://github.com/KNIT-NZ/open-order/blob/main/CONTRIBUTING.md">Contribute</a>
        {" · "}<a href="https://github.com/KNIT-NZ/open-order/blob/main/SECURITY.md">Security</a>
      </div>
    </footer>
  );
}
