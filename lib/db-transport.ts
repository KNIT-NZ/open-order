/** Require certificate and hostname verification for remote PostgreSQL connections. */
export function verifiedDatabaseUrl(connectionString: string, environment: string): string {
  const url = new URL(connectionString);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Expected a PostgreSQL connection URL.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  // A local developer may explicitly use a plaintext loopback database only.
  if (environment !== "production" && loopback &&
      (!url.searchParams.has("sslmode") || url.searchParams.get("sslmode") === "disable")) {
    url.searchParams.delete("ssl");
    url.searchParams.set("sslmode", "disable");
    return url.toString();
  }
  url.searchParams.delete("ssl");
  url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}
