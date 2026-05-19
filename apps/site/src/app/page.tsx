import Image from "next/image";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.mark}>
          <Image
            src="/logo.png"
            alt="Genizor"
            width={80}
            height={80}
            priority
          />
        </div>

        <p className={styles.eyebrow}>Work in progress</p>

        <h1 className={styles.title}>Genizor</h1>

        <p className={styles.tagline}>
          Open-source AI email triage, rooted in your own workflow.
        </p>

        <p className={styles.body}>
          Genizor is a self-hostable assistant layer for Gmail that helps sort,
          draft, and escalate email through a visual workflow. The product is
          currently in development.
        </p>

        <footer className={styles.footer}>
          <a
            className={styles.link}
            href="https://github.com/genizor"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </footer>
      </div>
    </main>
  );
}
