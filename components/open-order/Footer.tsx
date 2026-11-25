// components/open-order/Footer.tsx
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
        Open Order is an independent, unofficial experimental parliamentary procedural navigator developed by KNIT, not operated or endorsed by Parliament. AI requests are processed by external providers. Do not enter confidential, privileged or identifying information. Check original authorities and official guidance. Do not post sensitive questions or diagnostic snapshots in public feedback.
        {" "}<a href="https://github.com/KNIT-NZ/open-order">Source code</a>
        {" · "}<a href="https://github.com/KNIT-NZ/open-order/issues">Feedback</a>
        {" · "}<a href="https://github.com/KNIT-NZ/open-order/blob/main/CONTRIBUTING.md">Contribute</a>
        {" · "}<a href="https://github.com/KNIT-NZ/open-order/blob/main/SECURITY.md">Security</a>
      </div>
    </footer>
  );
}
